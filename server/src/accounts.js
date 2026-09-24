// Accounts: login (checked against Gitea over the internal network), roles, terms of
// use, password changes and reset links, data export and deletion.
//
// Roles:
//   operator    runs the instance (accounts, access, logs, pause, legal pages).
//               Listed in OPERATOR_LOGINS; never imports tests.
//   maintainer  imports and publishes testsuites. Pseudonymous login ("m-xxxxxx"),
//               no email; never sees who the students are.
//   student     pushes code and reads their own results.
import crypto from 'node:crypto';
import { config, isOperatorLogin } from './config.js';
import { db, now, logActivity } from './db.js';
import * as gitea from './gitea.js';
import { getTermsVersion } from './legal.js';
import { hashToken, randomToken } from './tokens.js';
import { REFERENCE_STUDENT } from './validation.js';

export const LOGIN_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{1,38}$/;
export const MIN_PASSWORD_LENGTH = 8;
const httpError = (status, message) => Object.assign(new Error(message), { status });

export function roleOf(login) {
  if (isOperatorLogin(login)) return 'operator';
  const row = db().prepare('SELECT role, active FROM students WHERE login = ?').get(login);
  return row?.role === 'maintainer' && row.active ? 'maintainer' : 'student';
}

export function termsAccepted(login) {
  const row = db().prepare('SELECT terms_version FROM students WHERE login = ?').get(login);
  return Boolean(row?.terms_version) && row.terms_version >= getTermsVersion();
}

export function acceptTerms(login) {
  db().prepare('UPDATE students SET terms_version = ?, terms_accepted_at = ? WHERE login = ?').run(getTermsVersion(), now(), login);
}

export function checkPassword(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH || password.length > 128) {
    throw httpError(400, `Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
}

// ---------------------------------------------------------------------------
// Login, with brute-force protection (in memory: failed attempts per login and
// per client address over 15 minutes; addresses are never written anywhere).
// ---------------------------------------------------------------------------
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES_PER_LOGIN = 8;
const MAX_FAILURES_PER_IP = 40;
const failures = new Map();

function recent(key) {
  const cutoff = Date.now() - WINDOW_MS;
  const list = (failures.get(key) ?? []).filter((t) => t > cutoff);
  if (list.length) failures.set(key, list);
  else failures.delete(key);
  return list;
}

function recordFailure(key) {
  failures.set(key, [...recent(key), Date.now()]);
}

export async function login({ login: typed, password, clientIp }) {
  const name = String(typed ?? '').trim();
  const loginKey = `login:${name.toLowerCase()}`;
  const ipKey = `ip:${clientIp || 'unknown'}`;
  if (recent(loginKey).length >= MAX_FAILURES_PER_LOGIN || recent(ipKey).length >= MAX_FAILURES_PER_IP) {
    throw httpError(429, 'Too many failed attempts. Wait 15 minutes and try again.');
  }
  if (!LOGIN_RE.test(name) || typeof password !== 'string' || !password || name === REFERENCE_STUDENT) {
    recordFailure(loginKey);
    recordFailure(ipKey);
    throw httpError(401, 'Wrong login or password.');
  }
  const canonical = await gitea.verifyPassword(name, password);
  if (!canonical) {
    recordFailure(loginKey);
    recordFailure(ipKey);
    throw httpError(401, 'Wrong login or password.');
  }
  failures.delete(loginKey);
  const row = db().prepare('SELECT * FROM students WHERE login = ?').get(canonical);
  if (row && !row.active) throw httpError(403, 'This account is disabled.');
  const operator = isOperatorLogin(canonical);
  if (!row) {
    // Accounts created directly in Gitea (e.g. the operator's) are registered at their first login.
    db().prepare("INSERT INTO students (login, role, created_via) VALUES (?, ?, 'login')").run(canonical, operator ? 'operator' : 'student');
  } else if (operator && row.role !== 'operator') {
    db().prepare("UPDATE students SET role = 'operator' WHERE login = ?").run(canonical);
  }
  db().prepare('UPDATE students SET last_login_at = ? WHERE login = ?').run(now(), canonical);
  logActivity('login', { student: canonical, detail: 'dashboard login' });
  return { login: canonical, role: roleOf(canonical) };
}

// ---------------------------------------------------------------------------
// Passwords
// ---------------------------------------------------------------------------
export async function changePassword(login, { current, next }) {
  checkPassword(next);
  if (!(await gitea.verifyPassword(login, String(current ?? '')))) throw httpError(400, 'The current password is wrong.');
  try {
    await gitea.setPassword(login, next);
  } catch (err) {
    if (err.status === 422) throw httpError(400, 'This password is not accepted: choose a longer or less common one.');
    throw err;
  }
  logActivity('account', { student: login, detail: 'password changed' });
}

export function createResetLink(login, operator, ttlHours = 72) {
  const row = db().prepare('SELECT login FROM students WHERE login = ?').get(login);
  if (!row) throw httpError(404, 'Unknown account.');
  db().prepare('UPDATE password_resets SET used_at = ? WHERE login = ? AND used_at IS NULL').run(now(), login);
  const token = randomToken();
  const expiresAt = new Date(Date.now() + ttlHours * 3600 * 1000).toISOString();
  db().prepare('INSERT INTO password_resets (token_hash, login, expires_at) VALUES (?, ?, ?)').run(hashToken(token), login, expiresAt);
  logActivity('admin_action', { student: operator, detail: `password reset link for ${login}` });
  return { token, expiresAt };
}

function usableReset(token) {
  if (typeof token !== 'string' || token.length < 20) return null;
  const row = db().prepare('SELECT * FROM password_resets WHERE token_hash = ?').get(hashToken(token));
  return row && !row.used_at && row.expires_at > now() ? row : null;
}

export function checkResetLink(token) {
  const row = usableReset(token);
  return row ? { valid: true, login: row.login, expiresAt: row.expires_at } : { valid: false };
}

export async function redeemResetLink(token, password) {
  checkPassword(password);
  const row = usableReset(token);
  if (!row) throw httpError(410, 'This link is invalid, expired or already used.');
  const claimed = db().prepare('UPDATE password_resets SET used_at = ? WHERE id = ? AND used_at IS NULL').run(now(), row.id);
  if (claimed.changes !== 1) throw httpError(410, 'This link was just used.');
  try {
    await gitea.setPassword(row.login, password);
  } catch (err) {
    db().prepare('UPDATE password_resets SET used_at = NULL WHERE id = ?').run(row.id);
    if (err.status === 422) throw httpError(400, 'This password is not accepted: choose a longer or less common one.');
    throw err;
  }
  logActivity('account', { student: row.login, detail: 'password reset' });
  return { login: row.login };
}

// ---------------------------------------------------------------------------
// Maintainers: pseudonymous logins, generated by the server, never chosen.
// ---------------------------------------------------------------------------
export function newMaintainerLogin() {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  for (;;) {
    const bytes = crypto.randomBytes(6);
    const login = `m-${[...bytes].map((b) => alphabet[b % alphabet.length]).join('')}`;
    const taken = db().prepare('SELECT 1 FROM students WHERE login = ?').get(login)
      || db().prepare('SELECT 1 FROM invitations WHERE preset_login = ? AND revoked_at IS NULL').get(login);
    if (!taken) return login;
  }
}

// ---------------------------------------------------------------------------
// Export and deletion (privacy rights, and automatic retention).
// ---------------------------------------------------------------------------
export async function exportData(login) {
  const account = db()
    .prepare('SELECT login, email, role, created_via, created_at, last_login_at, terms_version, terms_accepted_at FROM students WHERE login = ?')
    .get(login);
  const submissions = db()
    .prepare(
      `SELECT id, assignment, repo_name, commit_sha, status, passed, total, message, created_at, finished_at
         FROM submissions WHERE kind = 'push' AND student = ? ORDER BY id`,
    )
    .all(login)
    .map((s) => ({
      ...s,
      results: db()
        .prepare('SELECT category_path, test_name, status, error_message, expected_output, actual_output FROM test_results WHERE submission_id = ? ORDER BY position')
        .all(s.id),
    }));
  const reports = db()
    .prepare('SELECT assignment, category_path, test_name, message, status, admin_note AS answer, created_at FROM test_reports WHERE author = ?')
    .all(login);
  const votes = db()
    .prepare('SELECT r.assignment, r.category_path, r.test_name, v.vote, v.created_at FROM test_report_votes v JOIN test_reports r ON r.id = v.report_id WHERE v.student = ?')
    .all(login);
  const invitations = db()
    .prepare('SELECT note, created_at, expires_at, used_at, used_by, revoked_at FROM invitations WHERE created_by = ? AND created_by_admin = 0')
    .all(login);
  const repositories = await gitea.listUserRepos(login).then((r) => r.map((x) => x.name)).catch(() => []);
  return {
    exportedAt: now(),
    service: config.appName,
    note: 'Your code itself is in your Git repositories: clone them before deleting your account.',
    account,
    repositories,
    submissions,
    reports,
    votes,
    invitations,
  };
}

// Log lines written by other people or services that name the login ("personal
// invitation for <login>", worker context...): matched as a whole word, then deleted.
function forgetMentions(login) {
  // Logins only contain letters, digits, ".", "_" and "-": only "." needs escaping.
  const escaped = login.replace(/\./g, '\\.');
  const word = new RegExp(`(^|[^A-Za-z0-9._-])${escaped}($|[^A-Za-z0-9._-])`);
  const like = `%${login}%`;
  const activity = db().prepare('SELECT id, detail FROM activity_log WHERE detail LIKE ?').all(like);
  for (const row of activity) if (word.test(row.detail)) db().prepare('DELETE FROM activity_log WHERE id = ?').run(row.id);
  const logs = db().prepare('SELECT id, message, context FROM service_logs WHERE message LIKE ? OR context LIKE ?').all(like, like);
  for (const row of logs) if (word.test(row.message) || word.test(row.context ?? '')) db().prepare('DELETE FROM service_logs WHERE id = ?').run(row.id);
}

/** Deletes an account everywhere: Gitea (repositories included) and every row about it. */
export async function deleteAccount(login, { reason }) {
  if (isOperatorLogin(login)) throw httpError(400, 'Operator accounts are removed from OPERATOR_LOGINS first.');
  await gitea.deleteUser(login);
  db().transaction(() => {
    db().prepare("DELETE FROM submissions WHERE kind = 'push' AND student = ?").run(login);
    db().prepare('DELETE FROM test_report_votes WHERE student = ?').run(login);
    db().prepare('DELETE FROM test_reports WHERE author = ?').run(login);
    db().prepare('DELETE FROM invitations WHERE created_by = ? OR preset_login = ? OR used_by = ?').run(login, login, login);
    db().prepare('UPDATE students SET invited_by = NULL WHERE invited_by = ?').run(login);
    db().prepare('DELETE FROM password_resets WHERE login = ?').run(login);
    db().prepare('DELETE FROM activity_log WHERE student = ?').run(login);
    forgetMentions(login);
    db().prepare('DELETE FROM students WHERE login = ?').run(login);
  })();
  // The log line never names the deleted account.
  logActivity('account', { detail: `an account was deleted (${reason})` });
}
