// The ONE correction code path. Student pushes and testsuite validation (empty
// implementations) both go through runCorrection(), so what is validated in the
// admin panel is exactly what runs in production.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { config } from './config.js';

const RUNNER_UID = 1000;
const RUNNER_GID = 1000;
const OUTPUT_CAP = 256 * 1024;

export class InfraError extends Error {}
export class JobTimeoutError extends Error {}

/** Runs a command, capping captured output, killing it after timeoutMs. */
export function run(cmd, args, { timeoutMs = 60000, onTimeout, cwd, env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: env ? { ...process.env, ...env } : process.env });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const append = (current, chunk) =>
      current.length >= OUTPUT_CAP ? current : current + chunk.toString('utf8').slice(0, OUTPUT_CAP - current.length);
    child.stdout.on('data', (c) => { stdout = append(stdout, c); });
    child.stderr.on('data', (c) => { stderr = append(stderr, c); });
    const timer = setTimeout(async () => {
      timedOut = true;
      try {
        if (onTimeout) await onTimeout();
      } finally {
        child.kill('SIGKILL');
      }
    }, timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

function chownRecursive(target) {
  if (process.platform === 'win32' || process.getuid?.() !== 0) return;
  const walk = (p) => {
    fs.lchownSync(p, RUNNER_UID, RUNNER_GID);
    if (fs.lstatSync(p).isDirectory()) {
      for (const entry of fs.readdirSync(p)) walk(path.join(p, entry));
    }
  };
  walk(target);
}

// The security flags required for EVERY container, no exceptions.
function sandboxArgs(name) {
  return [
    'run', '--rm',
    '--network', 'none',
    `--memory=${config.containerMemory}`,
    `--memory-swap=${config.containerMemory}`,
    `--cpus=${config.containerCpus}`,
    `--pids-limit=${config.containerPids}`,
    '--read-only',
    '--tmpfs', '/tmp:rw,exec,nosuid,size=64m',
    '-u', `${RUNNER_UID}:${RUNNER_GID}`,
    '--security-opt=no-new-privileges',
    '--cap-drop=ALL',
    '--name', name,
  ];
}

async function forceRemove(name) {
  await run('docker', ['rm', '-f', name], { timeoutMs: 30000 }).catch(() => {});
}

/**
 * @param {object} opts
 * @param {string} opts.jobId          unique id, used for the temp dir and container name
 * @param {string} opts.slug
 * @param {string} opts.submissionDir  folder containing the CONTENT of <slug>/
 * @param {string} opts.testsDir       folder containing the Criterion files for this assignment
 * @param {object} [opts.compileConfig]  { default_flags, overrides } (see flags.js)
 * @param {(line: string) => void} opts.log
 * @returns {Promise<object>} the parsed report.json (see runner/pipeline.py)
 */
export async function runCorrection({ jobId, slug, submissionDir, testsDir, compileConfig, log }) {
  const root = path.join(config.jobsDir, jobId);
  const work = path.join(root, 'work');
  const name = `job-${jobId}`;
  const started = Date.now();
  try {
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(path.join(work, 'out'), { recursive: true });
    fs.cpSync(submissionDir, path.join(work, 'submission'), { recursive: true, dereference: false });
    fs.cpSync(testsDir, path.join(work, 'tests'), { recursive: true });
    fs.writeFileSync(path.join(work, 'config.json'), JSON.stringify(compileConfig ?? {}));
    if (compileConfig?.default_flags) log(`compilation flags: ${compileConfig.default_flags.join(' ')}`);
    chownRecursive(work);

    const remaining = config.jobTimeoutSec * 1000 - (Date.now() - started);
    const args = [
      ...sandboxArgs(name),
      '-v', `${work}:/work`,
      '-v', `${path.join(work, 'tests')}:/work/tests:ro`,
      '-e', `TEST_TIMEOUT=${config.testTimeoutSec}`,
      config.runnerImage,
      'python3', '/opt/remouline/pipeline.py',
      '--work', '/work',
      '--slug', slug,
    ];
    log(`starting container ${name} (image ${config.runnerImage})`);
    const res = await run('docker', args, {
      timeoutMs: Math.max(remaining, 10000),
      onTimeout: () => forceRemove(name),
    });
    if (res.stdout.trim()) log(`pipeline stdout:\n${res.stdout.trim()}`);
    if (res.stderr.trim()) log(`pipeline stderr:\n${res.stderr.trim()}`);

    if (res.timedOut) {
      throw new JobTimeoutError(`Correction exceeded the global limit of ${config.jobTimeoutSec}s and was killed.`);
    }
    // 125: docker could not run the container, 126/127: command not runnable in the image.
    if ([125, 126, 127].includes(res.code)) {
      throw new InfraError(`Docker failed to start the correction container (exit ${res.code}).`);
    }
    const reportPath = path.join(work, 'out', 'report.json');
    if (!fs.existsSync(reportPath)) {
      throw new InfraError(
        `The correction container exited with code ${res.code} without producing a report` +
          (res.code === 137 ? ' (killed, probably out of memory).' : '.'),
      );
    }
    try {
      return JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    } catch (err) {
      throw new InfraError(`Invalid report.json: ${err.message}`);
    }
  } catch (err) {
    if (err instanceof InfraError || err instanceof JobTimeoutError) throw err;
    throw new InfraError(`System error during correction: ${err.message}`);
  } finally {
    await forceRemove(name);
    fs.rmSync(root, { recursive: true, force: true });
  }
}
