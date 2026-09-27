// Central configuration. Every value comes from the environment (.env on the VM),
// never hardcoded secrets. See docs/DEPLOYMENT.md > "Secrets".

function env(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === '') {
    if (fallback === undefined) {
      throw new Error(`Missing required environment variable: ${name}`);
    }
    return fallback;
  }
  return value;
}

function envInt(name, fallback) {
  const raw = env(name, String(fallback));
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value)) {
    throw new Error(`Environment variable ${name} must be an integer (got "${raw}")`);
  }
  return value;
}

function envList(name, fallback = '') {
  return env(name, fallback)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

// Secrets are read lazily so that a service only fails on the secrets it actually uses.
export const secret = (name) => env(name);

export const config = {
  appName: env('APP_NAME', 'Remouline'),

  // Storage
  dataDir: env('DATA_DIR', '/data'),
  dbPath: env('DB_PATH', '/data/remouline.db'),
  assignmentsDir: env('ASSIGNMENTS_DIR', '/data/assignments'),
  // Must be the SAME absolute path on the host and inside the worker container,
  // because the worker asks the host Docker daemon to bind-mount job folders.
  jobsDir: env('JOBS_DIR', '/srv/remouline/jobs'),

  redisUrl: env('REDIS_URL', 'redis://redis:6379'),
  queueName: env('QUEUE_NAME', 'remouline-corrections'),

  // Gitea
  giteaInternalUrl: env('GITEA_INTERNAL_URL', 'http://gitea:3000').replace(/\/$/, ''),
  giteaPublicUrl: env('GITEA_PUBLIC_URL', 'https://git.example.com').replace(/\/$/, ''),

  // Ports
  apiPort: envInt('API_PORT', 8080),
  webhookPort: envInt('WEBHOOK_PORT', 8081),

  // Operators: logins that run the instance (accounts, access, logs, pause).
  // Maintainers (who import testsuites) are managed from the admin panel.
  operatorLogins: envList('OPERATOR_LOGINS'),

  // Worker / correction limits
  workerConcurrency: envInt('WORKER_CONCURRENCY', 2),
  runnerImage: env('RUNNER_IMAGE', 'remouline-runner'),
  // Used when an assignment has no flags of its own (bundle or admin panel).
  defaultCompileFlags: env('DEFAULT_COMPILE_FLAGS', '-Wall -Wextra -Werror'),
  jobTimeoutSec: envInt('JOB_TIMEOUT_SEC', 600),
  testTimeoutSec: envInt('TEST_TIMEOUT_SEC', 10),
  containerMemory: env('CONTAINER_MEMORY', '256m'),
  containerCpus: env('CONTAINER_CPUS', '0.5'),
  containerPids: envInt('CONTAINER_PIDS', 64),
  // Largest file a correction container may write (bytes).
  containerFsizeBytes: envInt('CONTAINER_FSIZE_BYTES', 64 * 1024 * 1024),

  // Anti-spam: never blocks a user, only delays their jobs.
  maxRunningPerStudent: envInt('MAX_RUNNING_PER_STUDENT', 1),
  maxJobsPerHourPerStudent: envInt('MAX_JOBS_PER_HOUR_PER_STUDENT', 20),

  // Invitations
  inviteTtlHours: envInt('INVITE_TTL_HOURS', 72),
  // Default sharing limit per user; the admin panel setting overrides it.
  maxInvitesPerStudent: envInt('MAX_INVITES_PER_STUDENT', 3),

  // Data retention (days). 0 disables a rule.
  logRetentionDays: envInt('LOG_RETENTION_DAYS', 30),
  // Submissions, results and Git repositories without activity for this long are deleted.
  dataRetentionDays: envInt('DATA_RETENTION_DAYS', 60),
  // Accounts (with all their data) without any login or push for this long are deleted.
  accountRetentionDays: envInt('ACCOUNT_RETENTION_DAYS', 180),
  // Kept by scripts/backup.sh on the backup destination (shown in the privacy notice).
  backupRetentionDays: envInt('BACKUP_RETENTION_DAYS', 30),
};

export function isOperatorLogin(login) {
  return Boolean(login) && config.operatorLogins.includes(login);
}
