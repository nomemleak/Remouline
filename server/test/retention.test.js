// Automatic deletion: stale pushes, repositories and inactive student accounts go,
// recent data and staff accounts stay.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startFakeGitea } from './helpers/fake-gitea.js';

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'remouline-retention-'));
const gitea = await startFakeGitea();
Object.assign(process.env, {
  DB_PATH: path.join(work, 'remouline.db'), ASSIGNMENTS_DIR: path.join(work, 'assignments'),
  GITEA_INTERNAL_URL: gitea.url, GITEA_ADMIN_TOKEN: 'admin-token', OPERATOR_LOGINS: 'operator',
  DATA_RETENTION_DAYS: '60', ACCOUNT_RETENTION_DAYS: '180', LOG_RETENTION_DAYS: '30',
});
// Imported after the environment is set: config.js reads it at load time.
const { db } = await import('../src/db.js');
const { runRetention } = await import('../src/retention.js');

after(() => {
  db().close();
  gitea.close();
  fs.rmSync(work, { recursive: true, force: true });
});

test('retention deletes old pushes, stale repositories, inactive accounts and old logs', async () => {
  const old = '2020-01-01T00:00:00.000Z';
  const recent = new Date().toISOString();
  const d = db();
  d.prepare("INSERT INTO students (login, role, created_at, last_login_at) VALUES ('active', 'student', ?, ?)").run(old, recent);
  d.prepare("INSERT INTO students (login, role, created_at, last_login_at) VALUES ('sleeper', 'student', ?, ?)").run(old, old);
  d.prepare("INSERT INTO students (login, role, created_at, last_login_at) VALUES ('m-abcdef', 'maintainer', ?, ?)").run(old, old);
  d.prepare("INSERT INTO submissions (student, assignment, status, created_at) VALUES ('active', 'X', 'done', ?)").run(old);
  d.prepare("INSERT INTO submissions (student, assignment, status, created_at) VALUES ('active', 'X', 'done', ?)").run(recent);
  d.prepare("INSERT INTO activity_log (event_type, student, detail, timestamp) VALUES ('push', 'active', 'old event', ?)").run(old);
  gitea.repos.set('active', [{ name: 'stale', updated_at: old }, { name: 'fresh', updated_at: recent }]);
  gitea.repos.set('sleeper', [{ name: 'x', updated_at: old }]);

  await runRetention();

  assert.equal(d.prepare("SELECT COUNT(*) AS n FROM submissions WHERE student = 'active'").get().n, 1, 'old push deleted, recent one kept');
  assert.deepEqual(gitea.repos.get('active').map((r) => r.name), ['fresh'], 'stale repository deleted');
  assert.deepEqual(gitea.deleted, ['sleeper'], 'only the inactive student account is deleted');
  assert.ok(!d.prepare("SELECT 1 FROM students WHERE login = 'sleeper'").get());
  assert.ok(d.prepare("SELECT 1 FROM students WHERE login = 'm-abcdef'").get(), 'maintainers are never deleted automatically');
  assert.equal(d.prepare("SELECT COUNT(*) AS n FROM activity_log WHERE detail = 'old event'").get().n, 0, 'old logs deleted');
});
