// Automatic deletion (privacy by default), run by the API process every few hours:
//   - pushes and their results older than DATA_RETENTION_DAYS;
//   - Git repositories not updated for DATA_RETENTION_DAYS (Gitea);
//   - student accounts without login or push for ACCOUNT_RETENTION_DAYS, with all their data;
//   - activity/service logs, used or expired links and closed reports older than LOG_RETENTION_DAYS.
// A rule set to 0 days is disabled. Operators and maintainers are never deleted automatically.
import { config } from './config.js';
import { db } from './db.js';
import { createLogger } from './logger.js';
import * as gitea from './gitea.js';
import { deleteAccount } from './accounts.js';

const logger = createLogger('retention');
const RUN_EVERY_MS = 6 * 3600 * 1000;
const cutoff = (days) => new Date(Date.now() - days * 86400 * 1000).toISOString();

function pruneRows() {
  const counts = {};
  if (config.dataRetentionDays > 0) {
    // test_results rows go with their submission (ON DELETE CASCADE).
    counts.submissions = db()
      .prepare("DELETE FROM submissions WHERE kind = 'push' AND created_at < ? AND status NOT IN ('queued', 'running')")
      .run(cutoff(config.dataRetentionDays)).changes;
  }
  if (config.logRetentionDays > 0) {
    const before = cutoff(config.logRetentionDays);
    counts.activity = db().prepare('DELETE FROM activity_log WHERE timestamp < ?').run(before).changes;
    counts.serviceLogs = db().prepare('DELETE FROM service_logs WHERE ts < ?').run(before).changes;
    counts.invitations = db()
      .prepare('DELETE FROM invitations WHERE (used_at IS NOT NULL OR revoked_at IS NOT NULL OR expires_at < ?) AND created_at < ?')
      .run(new Date().toISOString(), before).changes;
    counts.resets = db().prepare('DELETE FROM password_resets WHERE created_at < ?').run(before).changes;
    counts.reports = db().prepare("DELETE FROM test_reports WHERE status != 'open' AND closed_at < ?").run(before).changes;
  }
  return counts;
}

async function pruneRepositories() {
  if (config.dataRetentionDays <= 0) return 0;
  const before = cutoff(config.dataRetentionDays);
  let deleted = 0;
  const students = db().prepare("SELECT login FROM students WHERE role = 'student'").all();
  for (const { login } of students) {
    const repos = await gitea.listUserRepos(login).catch(() => []);
    for (const repo of repos) {
      if (repo.updated_at && repo.updated_at < before) {
        await gitea.deleteRepo(login, repo.name);
        deleted += 1;
      }
    }
  }
  return deleted;
}

async function pruneAccounts() {
  if (config.accountRetentionDays <= 0) return 0;
  const before = cutoff(config.accountRetentionDays);
  const inactive = db()
    .prepare(
      `SELECT st.login FROM students st
        WHERE st.role = 'student'
          AND COALESCE(st.last_login_at, st.created_at) < ?
          AND st.created_at < ?
          AND NOT EXISTS (SELECT 1 FROM submissions s WHERE s.kind = 'push' AND s.student = st.login AND s.created_at >= ?)`,
    )
    .all(before, before, before);
  for (const { login } of inactive) {
    if (config.operatorLogins.includes(login)) continue;
    await deleteAccount(login, { reason: 'inactivity' });
  }
  return inactive.length;
}

export async function runRetention() {
  try {
    const rows = pruneRows();
    const repositories = await pruneRepositories();
    const accounts = await pruneAccounts();
    logger.info('retention done', { ...rows, repositories, accounts });
  } catch (err) {
    logger.error(`retention failed: ${err.message}`);
  }
}

export function startRetention() {
  setTimeout(runRetention, 60 * 1000).unref();
  setInterval(runRetention, RUN_EVERY_MS).unref();
}
