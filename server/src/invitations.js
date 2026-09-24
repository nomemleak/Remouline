// Invitation-only access. Tokens are random, single-use, expiring, and stored
// ONLY as a SHA-256 hash. Two modes (settings.access_mode):
//   closed  - only operators create invitations
//   sharing - existing students may also sponsor someone (traceable via invited_by)
// An invitation creates a student account, or a maintainer account (operators only,
// with a server-generated pseudonymous login).
import { config } from './config.js';
import { db, now, getSetting, setSetting, logActivity } from './db.js';
import { createUser } from './gitea.js';
import { hashToken, randomToken } from './tokens.js';
import { LOGIN_RE, checkPassword, acceptTerms } from './accounts.js';
import { isPaused } from './service.js';

export { hashToken };
export const ACCESS_MODES = ['closed', 'sharing'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const httpError = (status, message) => Object.assign(new Error(message), { status });

export function getAccessMode() {
  return getSetting('access_mode', 'closed');
}

export function setAccessMode(mode, operator) {
  if (!ACCESS_MODES.includes(mode)) throw new Error(`Unknown access mode: ${mode}`);
  setSetting('access_mode', mode);
  if (mode === 'closed') {
    // Pending invitations sponsored by students become invalid immediately.
    db()
      .prepare('UPDATE invitations SET revoked_at = ? WHERE created_by_admin = 0 AND used_at IS NULL AND revoked_at IS NULL')
      .run(now());
  }
  logActivity('admin_action', { student: operator, detail: `access mode set to "${mode}"` });
}

// ---------------------------------------------------------------------------
// Per-student sharing quota (operator setting). A share counts once someone joined
// with it, or while it is still pending; revoked/expired unused links free the
// slot. Lowering the limit never revokes anything: accounts and links already
// created stay valid, the student simply cannot create new ones.
// ---------------------------------------------------------------------------
export const MAX_INVITES_CEILING = 100;

export function getMaxInvitesPerStudent() {
  const value = Number.parseInt(getSetting('max_invites_per_student', String(config.maxInvitesPerStudent)), 10);
  return Number.isNaN(value) ? config.maxInvitesPerStudent : value;
}

export function setMaxInvitesPerStudent(value, operator) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > MAX_INVITES_CEILING) {
    throw httpError(400, `The limit must be an integer between 0 and ${MAX_INVITES_CEILING}.`);
  }
  setSetting('max_invites_per_student', n);
  logActivity('admin_action', { student: operator, detail: `sharing limit set to ${n} per student` });
}

export function countSharesOf(login) {
  return db()
    .prepare(
      `SELECT COUNT(*) AS n FROM invitations
        WHERE created_by = ? AND created_by_admin = 0 AND revoked_at IS NULL
          AND (used_at IS NOT NULL OR expires_at > ?)`,
    )
    .get(login, now()).n;
}

export function getShareQuota(login) {
  const used = countSharesOf(login);
  const limit = getMaxInvitesPerStudent();
  return { used, limit, remaining: Math.max(limit - used, 0) };
}

/**
 * @param {object} opts
 * @param {boolean} opts.isAdmin       created by an operator (else: student sharing)
 * @param {string} [opts.presetLogin]  personal invitation: login fixed in advance
 * @param {string} [opts.presetEmail]  optional
 * @param {'student'|'maintainer'} [opts.role]
 * @param {number} [opts.ttlHours]     operators only, defaults to INVITE_TTL_HOURS
 */
export function createInvitation({ createdBy, isAdmin, note = null, presetLogin = null, presetEmail = null, ttlHours = null, role = 'student' }) {
  if ((presetLogin || presetEmail || ttlHours || role !== 'student') && !isAdmin) throw httpError(403, 'Forbidden.');
  if (!['student', 'maintainer'].includes(role)) throw httpError(400, 'Unknown role.');
  if (presetLogin && !LOGIN_RE.test(presetLogin)) throw httpError(400, `Invalid login: ${presetLogin}`);
  if (presetEmail && !EMAIL_RE.test(presetEmail)) throw httpError(400, `Invalid email: ${presetEmail}`);
  if (presetEmail && !presetLogin) throw httpError(400, 'An email can only be fixed together with a login.');
  if (!isAdmin) {
    if (getAccessMode() !== 'sharing') throw httpError(403, 'Invitations are disabled.');
    const quota = getShareQuota(createdBy);
    if (quota.remaining === 0) throw httpError(429, `You have reached your sharing limit (${quota.used} / ${quota.limit}).`);
  }
  const token = randomToken();
  const hours = Math.min(Math.max(Number(ttlHours) || config.inviteTtlHours, 1), 60 * 24);
  const expiresAt = new Date(Date.now() + hours * 3600 * 1000).toISOString();
  const info = db()
    .prepare(
      `INSERT INTO invitations (token_hash, created_by, created_by_admin, note, expires_at, preset_login, preset_email, role)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(hashToken(token), createdBy, isAdmin ? 1 : 0, note, expiresAt, presetLogin, presetEmail, role);
  logActivity('invite', { student: createdBy, detail: `created invitation #${info.lastInsertRowid}${role === 'maintainer' ? ' (maintainer)' : ''}` });
  return { id: Number(info.lastInsertRowid), token, expiresAt };
}

function findUsable(token) {
  if (typeof token !== 'string' || token.length < 20) return null;
  const inv = db().prepare('SELECT * FROM invitations WHERE token_hash = ?').get(hashToken(token));
  if (!inv || inv.used_at || inv.revoked_at || inv.expires_at <= now()) return null;
  if (!inv.created_by_admin) {
    if (getAccessMode() !== 'sharing') return null;
    const sponsor = db().prepare('SELECT active FROM students WHERE login = ?').get(inv.created_by);
    if (!sponsor || !sponsor.active) return null;
  }
  return inv;
}

// Never says who created the invitation.
export function checkInvitation(token) {
  if (isPaused()) return { valid: false, paused: true };
  const inv = findUsable(token);
  return inv
    ? { valid: true, expiresAt: inv.expires_at, login: inv.preset_login ?? null, email: inv.preset_email ?? null, role: inv.role }
    : { valid: false };
}

/** The user chooses the password of their (Gitea-backed) account right here, and accepts the terms. */
export async function redeemInvitation(token, { login: typedLogin, email: typedEmail, password, acceptTerms: accepted }) {
  if (isPaused()) throw httpError(503, 'The service is paused: accounts cannot be created for now.');
  const inv = findUsable(token);
  if (!inv) throw httpError(410, 'This invitation is invalid, expired or already used.');
  if (accepted !== true) throw httpError(400, 'You must accept the terms of use to create an account.');
  // Personal invitations: the login (and email, if any) were fixed by the operator.
  const login = inv.preset_login ?? String(typedLogin ?? '').trim();
  const email = inv.preset_login ? inv.preset_email : String(typedEmail ?? '').trim() || null;
  if (!LOGIN_RE.test(login)) throw httpError(400, 'Invalid login (letters, digits, ".", "_", "-").');
  if (email && !EMAIL_RE.test(email)) throw httpError(400, 'Invalid email address.');
  checkPassword(password);

  // Claim the token atomically first, so it can never be used twice concurrently.
  const claimed = db()
    .prepare('UPDATE invitations SET used_at = ?, used_by = ? WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL')
    .run(now(), login, inv.id);
  if (claimed.changes !== 1) throw httpError(410, 'This invitation was just used.');

  try {
    await createUser({ login, email, password });
    db()
      .prepare(
        `INSERT INTO students (login, email, role, created_via, invited_by) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(login) DO UPDATE SET invited_by = excluded.invited_by, role = excluded.role`,
      )
      .run(login, email, inv.role, inv.created_by_admin ? 'admin' : 'invite', inv.created_by_admin ? null : inv.created_by);
    acceptTerms(login);
    logActivity('invite', { student: login, detail: `joined with invitation #${inv.id}` });
    return { login };
  } catch (err) {
    db().prepare('UPDATE invitations SET used_at = NULL, used_by = NULL WHERE id = ?').run(inv.id);
    if (err.status === 422 && /password/i.test(err.message)) {
      throw httpError(400, 'This password is not accepted: choose a longer or less common one.');
    }
    const status = err.status === 422 || err.status === 409 ? 409 : 502;
    throw httpError(status, status === 409 ? 'This login or email is already taken.' : 'Account creation failed, try again later.');
  }
}

export function revokeInvitation(id, { by, isAdmin }) {
  const inv = db().prepare('SELECT * FROM invitations WHERE id = ?').get(id);
  if (!inv || (!isAdmin && inv.created_by !== by)) return false;
  db().prepare('UPDATE invitations SET revoked_at = ? WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL').run(now(), id);
  return true;
}

export function revokePendingInvitationsOf(login) {
  db().prepare('UPDATE invitations SET revoked_at = ? WHERE created_by = ? AND used_at IS NULL AND revoked_at IS NULL').run(now(), login);
}

// Never returns token hashes.
export function listInvitations({ createdBy, role } = {}) {
  const cols = 'id, created_by, created_by_admin, note, created_at, expires_at, used_at, used_by, revoked_at, preset_login, preset_email, role';
  if (createdBy) return db().prepare(`SELECT ${cols} FROM invitations WHERE created_by = ? ORDER BY id DESC`).all(createdBy);
  if (role) return db().prepare(`SELECT ${cols} FROM invitations WHERE role = ? ORDER BY id DESC`).all(role);
  return db().prepare(`SELECT ${cols} FROM invitations ORDER BY id DESC`).all();
}
