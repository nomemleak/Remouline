// Worker pool: dequeues correction jobs from Redis and grades them in Docker.
// Start several instances (or raise WORKER_CONCURRENCY) to scale out.
import fs from 'node:fs';
import path from 'node:path';
import { Worker, DelayedError } from 'bullmq';
import { config, secret } from './config.js';
import { logActivity } from './db.js';
import { createLogger } from './logger.js';
import { redis } from './queue.js';
import { internalCloneUrl } from './gitea.js';
import { dirs, getAssignment, getPublishedAssignment, hasFiles, resolveSlug } from './assignments.js';
import { pipelineConfig, publishedConfig } from './flags.js';
import { runCorrection, run, InfraError, JobTimeoutError } from './correction.js';
import {
  getSubmission, markRunning, setWaitingMessage, setAssignment, finishSubmission, saveReport,
} from './results.js';
import { evaluateValidation } from './validation.js';
import { isPaused } from './service.js';

const logger = createLogger('worker');

// ---------------------------------------------------------------------------
// Per-student throttling: at most N running jobs per student and M job starts
// per rolling hour. Over the limit, the job is DELAYED, never dropped.
// ---------------------------------------------------------------------------
const THROTTLE_LUA = `
local now = tonumber(ARGV[1])
local ttl = tonumber(ARGV[5])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now - 3600000)
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[3]) then
  return {1, now + 10000}
end
if redis.call('ZCARD', KEYS[2]) >= tonumber(ARGV[4]) then
  local oldest = redis.call('ZRANGE', KEYS[2], 0, 0, 'WITHSCORES')
  return {2, tonumber(oldest[2]) + 3600000 + 1000}
end
redis.call('ZADD', KEYS[1], now + ttl, ARGV[2])
redis.call('ZADD', KEYS[2], now, ARGV[2] .. ':' .. now)
redis.call('PEXPIRE', KEYS[1], ttl)
redis.call('PEXPIRE', KEYS[2], 3600000)
return {0, 0}
`;

async function acquireSlot(student, member) {
  const [code, until] = await redis().eval(
    THROTTLE_LUA, 2,
    `remouline:running:${student}`, `remouline:starts:${student}`,
    Date.now(), member, config.maxRunningPerStudent, config.maxJobsPerHourPerStudent,
    (config.jobTimeoutSec + 300) * 1000,
  );
  return { code: Number(code), until: Number(until) };
}

async function releaseSlot(student, member) {
  await redis().zrem(`remouline:running:${student}`, member).catch(() => {});
}

// ---------------------------------------------------------------------------
// Repository handling
// ---------------------------------------------------------------------------
async function git(args, log, opts = {}) {
  const res = await run('git', args, { timeoutMs: 120000, ...opts });
  if (res.code !== 0) {
    throw new InfraError(`git ${args.filter((a) => !a.includes('Authorization')).join(' ')} failed: ${res.stderr.trim()}`);
  }
  log(`git ${args.find((a) => ['clone', 'fetch', 'checkout'].includes(a))} ok`);
  return res;
}

async function cloneRevision(sub, dest, log) {
  // Git over HTTP: Basic auth with the access token as username (Gitea convention).
  const basic = Buffer.from(`${secret('GITEA_CLONE_TOKEN')}:x-oauth-basic`).toString('base64');
  const auth = `http.extraHeader=Authorization: Basic ${basic}`;
  const url = internalCloneUrl(sub.student, sub.repo_name);
  log(`cloning ${sub.student}/${sub.repo_name} @ ${sub.commit_sha}`);
  await git(['-c', auth, 'clone', '--quiet', '--no-tags', '--single-branch', '--branch', 'main', '--depth', '50', url, dest], log);
  const checkout = await run('git', ['-C', dest, 'checkout', '--quiet', '--detach', sub.commit_sha]);
  if (checkout.code !== 0) {
    await git(['-c', auth, '-C', dest, 'fetch', '--quiet', '--unshallow', 'origin'], log);
    await git(['-C', dest, 'checkout', '--quiet', '--detach', sub.commit_sha], log);
  }
}

// ---------------------------------------------------------------------------
// Job processing
// ---------------------------------------------------------------------------
function makeJobLog() {
  const lines = [];
  const log = (line) => lines.push(`[${new Date().toISOString()}] ${line}`);
  return { log, text: () => lines.join('\n').slice(-200000) };
}

async function grade(sub, { slug, submissionDir, testsDir, jobId, log, validation = false }) {
  try {
    // Pushes use what was frozen at publication; validation uses the current draft.
    const assignment = getAssignment(slug);
    const compileConfig = validation ? pipelineConfig(assignment) : publishedConfig(assignment);
    const report = await runCorrection({ jobId, slug, submissionDir, testsDir, compileConfig, log, validation });
    // Deleted while it ran (e.g. its assignment was deleted): nothing left to save.
    if (!getSubmission(sub.id)) return { status: 'discarded' };
    const { passed, total } = saveReport(sub.id, report);
    return { status: 'done', passed, total, message: report.message ?? null };
  } catch (err) {
    if (err instanceof JobTimeoutError) return { status: 'timeout', message: err.message };
    if (err instanceof InfraError) return { status: 'infra_error', message: err.message };
    throw err;
  }
}

async function processPush(sub, jobId, log) {
  const cloneDir = path.join(config.jobsDir, `${jobId}-clone`);
  try {
    fs.rmSync(cloneDir, { recursive: true, force: true });
    await cloneRevision(sub, cloneDir, log);
    const resolved = resolveSlug(cloneDir);
    if (resolved.error) {
      log(resolved.error);
      return { status: 'not_configured', message: resolved.error };
    }
    const { slug } = resolved;
    setAssignment(sub.id, slug);
    log(`resolved assignment slug: ${slug}`);
    if (!getPublishedAssignment(slug)) {
      return {
        status: 'not_configured',
        message: `Assignment "${slug}" is not configured on ${config.appName} (no published testsuite for this folder name).`,
      };
    }
    return await grade(sub, {
      slug, jobId, log,
      submissionDir: path.join(cloneDir, slug),
      testsDir: dirs(slug).tests,
    });
  } finally {
    fs.rmSync(cloneDir, { recursive: true, force: true });
  }
}

async function processValidation(sub, data, jobId, log) {
  // The empty implementations generated from the headers (stubs.js) are graded like a push.
  const d = dirs(data.slug);
  if (!hasFiles(d.staging)) return { status: 'infra_error', message: 'No imported tests to validate.' };
  const submissionDir = data.role === 'stub_other' ? d.stubOther : d.stub;
  fs.mkdirSync(submissionDir, { recursive: true });
  return grade(sub, { slug: data.slug, submissionDir, testsDir: d.staging, jobId, log, validation: true });
}

async function processJob(job, token) {
  const data = job.data;
  const sub = getSubmission(data.submissionId);
  if (!sub) {
    logger.warn(`job ${job.id}: submission ${data.submissionId} no longer exists, skipping`);
    return;
  }

  const member = `${sub.id}`;
  if (data.type === 'push' && isPaused()) {
    // Emergency pause: queued pushes wait (checked again every minute).
    setWaitingMessage(sub.id, 'The service is paused: this push will be graded when it resumes.');
    await job.moveToDelayed(Date.now() + 60_000, token);
    throw new DelayedError();
  }
  if (data.type === 'push') {
    const slot = await acquireSlot(sub.student, member);
    if (slot.code !== 0) {
      const reason = slot.code === 1
        ? 'Waiting for your previous submission to finish.'
        : `Hourly submission limit reached (${config.maxJobsPerHourPerStudent}/h): queued until ${new Date(slot.until).toISOString()}.`;
      setWaitingMessage(sub.id, reason);
      await job.moveToDelayed(slot.until, token);
      throw new DelayedError();
    }
  }

  const jobId = `${sub.id}-${sub.attempt}-${Date.now().toString(36)}`;
  const { log, text } = makeJobLog();
  markRunning(sub.id);
  logger.info(`job ${jobId} started`, { submission: sub.id, type: data.type, student: sub.student });
  let outcome;
  try {
    outcome = data.type === 'validation'
      ? await processValidation(sub, data, jobId, log)
      : await processPush(sub, jobId, log);
  } catch (err) {
    log(`unexpected error: ${err.stack || err.message}`);
    outcome = { status: 'infra_error', message: err instanceof InfraError ? err.message : `Internal error: ${err.message}` };
  } finally {
    if (data.type === 'push') await releaseSlot(sub.student, member);
  }

  if (outcome.status === 'discarded') {
    logger.info(`job ${jobId}: submission ${sub.id} was deleted meanwhile, result discarded`);
    return;
  }
  finishSubmission(sub.id, { ...outcome, jobLog: text() });
  const level = outcome.status === 'infra_error' ? 'error' : 'info';
  logger[level](`job ${jobId} finished: ${outcome.status}`, { submission: sub.id, message: outcome.message ?? undefined });
  if (data.type === 'validation') evaluateValidation(data.slug);
  if (data.type === 'push' && outcome.status === 'not_configured') {
    logActivity('push', { student: sub.student, assignment: sub.assignment, detail: `not configured: ${outcome.message}` });
  }
}

fs.mkdirSync(config.jobsDir, { recursive: true });
const worker = new Worker(config.queueName, processJob, {
  connection: redis(),
  concurrency: config.workerConcurrency,
  lockDuration: (config.jobTimeoutSec + 120) * 1000,
});
worker.on('failed', (job, err) => {
  if (err instanceof DelayedError) return;
  logger.error(`job ${job?.id} crashed in the worker: ${err.message}`);
});
logger.info(`worker started (concurrency ${config.workerConcurrency}, image ${config.runnerImage})`);

const shutdown = async () => {
  await worker.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
