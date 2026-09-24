// Receives Gitea's system webhook on every push, verifies its HMAC signature and
// enqueues a correction job. Listens on the internal Docker network only
// (never exposed through the tunnel).
import crypto from 'node:crypto';
import express from 'express';
import { config, secret } from './config.js';
import { db, logActivity } from './db.js';
import { createLogger } from './logger.js';
import { enqueueSubmission } from './queue.js';
import { isPaused } from './service.js';

const logger = createLogger('webhook');
const ZERO_SHA = /^0+$/;

function signatureValid(rawBody, signature) {
  if (!signature) return false;
  const expected = crypto.createHmac('sha256', secret('GITEA_WEBHOOK_SECRET')).update(rawBody).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(signature), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const app = express();
app.disable('x-powered-by');

app.get('/healthz', (_req, res) => res.json({ ok: true }));

app.post('/webhook', express.raw({ type: '*/*', limit: '5mb' }), async (req, res) => {
  if (!signatureValid(req.body, req.get('X-Gitea-Signature'))) {
    logger.warn('rejected webhook with an invalid signature');
    return res.status(401).json({ error: 'invalid signature' });
  }
  const event = req.get('X-Gitea-Event');
  if (event !== 'push') return res.status(202).json({ ignored: `event ${event}` });

  let payload;
  try {
    payload = JSON.parse(req.body.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'invalid JSON' });
  }

  const repo = payload.repository ?? {};
  const owner = repo.owner?.login || repo.owner?.username;
  const sha = payload.after;
  if (payload.ref !== 'refs/heads/main') return res.status(202).json({ ignored: `ref ${payload.ref}` });
  if (!owner || !repo.name || !sha || ZERO_SHA.test(sha)) return res.status(202).json({ ignored: 'branch deletion or incomplete payload' });

  if (isPaused()) {
    logger.info('push ignored: the service is paused');
    return res.status(202).json({ ignored: 'service paused' });
  }

  const student = db().prepare('SELECT * FROM students WHERE login = ?').get(owner);
  if (student && !student.active) {
    logger.warn(`push from disabled account ${owner} ignored`);
    return res.status(202).json({ ignored: 'account disabled' });
  }
  if (!student) {
    db().prepare("INSERT OR IGNORE INTO students (login, created_via) VALUES (?, 'gitea')").run(owner);
  }

  const info = db()
    .prepare("INSERT INTO submissions (kind, student, repo_name, commit_sha, status) VALUES ('push', ?, ?, ?, 'queued')")
    .run(owner, repo.name, sha);
  const submissionId = Number(info.lastInsertRowid);
  logActivity('push', { student: owner, detail: `${repo.name}@${sha.slice(0, 10)} (submission #${submissionId})` });

  try {
    await enqueueSubmission({ type: 'push', submissionId });
  } catch (err) {
    db().prepare("UPDATE submissions SET status = 'infra_error', message = ? WHERE id = ?")
      .run(`Could not enqueue the job: ${err.message}`, submissionId);
    logger.error(`failed to enqueue submission ${submissionId}: ${err.message}`);
    return res.status(500).json({ error: 'queue unavailable' });
  }
  logger.info(`queued submission ${submissionId} for ${owner}/${repo.name}@${sha.slice(0, 10)}`);
  return res.status(202).json({ submissionId });
});

app.listen(config.webhookPort, '0.0.0.0', () => logger.info(`webhook receiver listening on :${config.webhookPort}`));
