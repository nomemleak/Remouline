// SQLite access shared by the API, the webhook receiver and the workers.
// WAL mode + busy timeout lets several processes share the same file safely.
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from './config.js';

const SCHEMA = `
-- Every account (the name is historical): students, maintainers and operators.
CREATE TABLE IF NOT EXISTS students (
  login              TEXT PRIMARY KEY,
  email              TEXT,                            -- optional
  role               TEXT NOT NULL DEFAULT 'student', -- student | maintainer | operator
  active             INTEGER NOT NULL DEFAULT 1,
  created_via        TEXT NOT NULL DEFAULT 'admin',   -- admin | invite | login | gitea
  invited_by         TEXT,                            -- login of the sponsor (trusted sharing)
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_login_at      TEXT,
  terms_version      INTEGER,                         -- version of the terms of use accepted
  terms_accepted_at  TEXT
);

CREATE TABLE IF NOT EXISTS assignments (
  slug               TEXT PRIMARY KEY,           -- == assignment folder at the root of the student repo
  title              TEXT,
  status             TEXT NOT NULL DEFAULT 'draft', -- draft | published
  tests_version      INTEGER NOT NULL DEFAULT 0,
  validation_status  TEXT NOT NULL DEFAULT 'none',  -- none | running | passed | failed
  validation_report  TEXT,                          -- JSON produced by validation.js
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  published_at       TEXT,
  validated_at       TEXT,
  compile_flags      TEXT,
  flag_overrides     TEXT,
  flags_source       TEXT NOT NULL DEFAULT 'fallback' -- bundle | admin | fallback
);

-- One row per push (never overwritten) and one row per reference-validation run.
CREATE TABLE IF NOT EXISTS submissions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  kind             TEXT NOT NULL DEFAULT 'push',  -- push | validation
  student          TEXT NOT NULL,
  assignment       TEXT,                          -- resolved slug (NULL until resolved)
  repo_name        TEXT,
  commit_sha       TEXT,
  validation_role  TEXT,                          -- stub | stub_other (kind = validation only)
  status           TEXT NOT NULL DEFAULT 'queued',
  -- queued | running | done | infra_error | not_configured | timeout
  passed           INTEGER,
  total            INTEGER,
  message          TEXT,
  job_log          TEXT,
  attempt          INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  started_at       TEXT,
  finished_at      TEXT,
  duration_ms      INTEGER
);
CREATE INDEX IF NOT EXISTS idx_submissions_student ON submissions(student, assignment, id);
CREATE INDEX IF NOT EXISTS idx_submissions_assignment ON submissions(assignment, id);

CREATE TABLE IF NOT EXISTS test_results (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id     INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  position          INTEGER NOT NULL,
  category_path     TEXT NOT NULL,   -- e.g. Testsuite/Fundamentals/create_village/count_houses
  test_name         TEXT NOT NULL,
  status            TEXT NOT NULL,   -- pass | fail | crash | timeout | skipped | error
  actual_output     TEXT,
  expected_output   TEXT,
  error_message     TEXT,
  raw_output        TEXT,            -- full sanitizer / valgrind / compiler output, shown as-is
  valgrind_ok       INTEGER,         -- 1 ok, 0 errors, NULL not run
  valgrind_details  TEXT,
  duration_ms       INTEGER
);
CREATE INDEX IF NOT EXISTS idx_test_results_submission ON test_results(submission_id, position);

CREATE TABLE IF NOT EXISTS activity_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type  TEXT NOT NULL,        -- push | login | admin_action | invite | report | account
  student     TEXT,
  assignment  TEXT,
  detail      TEXT,
  timestamp   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_activity_assignment ON activity_log(assignment, id);

CREATE TABLE IF NOT EXISTS service_logs (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  ts       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  service  TEXT NOT NULL,
  level    TEXT NOT NULL,
  message  TEXT NOT NULL,
  context  TEXT
);
CREATE INDEX IF NOT EXISTS idx_service_logs_ts ON service_logs(ts);

CREATE TABLE IF NOT EXISTS invitations (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash        TEXT NOT NULL UNIQUE,   -- sha256 of the token, the token itself is never stored
  created_by        TEXT NOT NULL,
  created_by_admin  INTEGER NOT NULL DEFAULT 0,
  note              TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at        TEXT NOT NULL,
  used_at           TEXT,
  used_by           TEXT,
  revoked_at        TEXT,
  role              TEXT NOT NULL DEFAULT 'student', -- account created: student | maintainer
  preset_login      TEXT,                            -- personal link: login fixed in advance
  preset_email      TEXT
);

-- Password reset links created by an operator (token stored as a SHA-256 hash only).
CREATE TABLE IF NOT EXISTS password_resets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash  TEXT NOT NULL UNIQUE,
  login       TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at  TEXT NOT NULL,
  used_at     TEXT
);

-- "I have the right to use the material these tests are derived from", recorded at
-- every testsuite import under the maintainer's pseudonymous login. Server-side only:
-- no API route returns this table.
CREATE TABLE IF NOT EXISTS testsuite_attestations (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment         TEXT NOT NULL,
  maintainer         TEXT NOT NULL,
  statement_version  INTEGER NOT NULL,
  content_hash       TEXT,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Students report a test they believe is wrong; every student of the assignment can vote.
CREATE TABLE IF NOT EXISTS test_reports (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment     TEXT NOT NULL,
  category_path  TEXT NOT NULL,
  test_name      TEXT NOT NULL,
  author         TEXT NOT NULL,
  message        TEXT NOT NULL,
  evidence       TEXT,            -- JSON snapshot of the reporter's result (message, expected, actual)
  status         TEXT NOT NULL DEFAULT 'open',   -- open | resolved | rejected
  admin_note     TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  closed_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_test_reports_assignment ON test_reports(assignment, status);

CREATE TABLE IF NOT EXISTS test_report_votes (
  report_id   INTEGER NOT NULL REFERENCES test_reports(id) ON DELETE CASCADE,
  student     TEXT NOT NULL,
  vote        INTEGER NOT NULL,   -- 1 = agrees the test is wrong, -1 = disagrees
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (report_id, student)
);

CREATE TABLE IF NOT EXISTS settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);
INSERT OR IGNORE INTO settings (key, value) VALUES ('access_mode', 'closed');
INSERT OR IGNORE INTO settings (key, value) VALUES ('terms_version', '1');
`;

let instance;

export function db() {
  if (!instance) {
    fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
    instance = new Database(config.dbPath);
    instance.pragma('journal_mode = WAL');
    instance.pragma('busy_timeout = 10000');
    instance.pragma('foreign_keys = ON');
    instance.exec(SCHEMA);
    migrate(instance);
  }
  return instance;
}

// Columns added after a release go here: CREATE TABLE IF NOT EXISTS never alters an
// existing table. Format: [table, column, type].
const ADDED_COLUMNS = [];

function migrate(database) {
  for (const [table, column, type] of ADDED_COLUMNS) {
    const exists = database.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
    if (!exists) database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

export const now = () => new Date().toISOString();

export function getSetting(key, fallback = null) {
  const row = db().prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  db()
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value));
}

export function logActivity(eventType, { student = null, assignment = null, detail = null } = {}) {
  db()
    .prepare('INSERT INTO activity_log (event_type, student, assignment, detail) VALUES (?, ?, ?, ?)')
    .run(eventType, student, assignment, detail);
}
