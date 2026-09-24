// Results API. Listens on the internal Docker network ONLY: it is never exposed
// through the tunnel, and only the dashboard container calls it, server-side
// (the tokens never reach a browser).
//
//   /v1/auth/login    login/password check (against Gitea, internally)
//   /v1/public/*      service status and the terms / privacy / legal pages
//   /v1/invite/*      invitation check/redeem (token-gated)
//   /v1/reset/*       password reset links (token-gated)
//   /v1/student/*     data of ONE user; the login is set by the dashboard from its
//                     verified session, never by the browser.
//   /v1/admin/*       admin panel; needs a SEPARATE token + an operator or maintainer login.
import crypto from 'node:crypto';
import express from 'express';
import { config, secret } from '../config.js';
import { db } from '../db.js';
import { createLogger } from '../logger.js';
import { studentRouter } from './student.js';
import { adminRouter } from './admin.js';
import { checkInvitation, redeemInvitation } from '../invitations.js';
import { login, roleOf, checkResetLink, redeemResetLink } from '../accounts.js';
import { getPage } from '../legal.js';
import { getServiceState } from '../service.js';
import { startRetention } from '../retention.js';

const logger = createLogger('api');

function tokenMatches(header, expected) {
  const match = /^Bearer (.+)$/.exec(header ?? '');
  if (!match) return false;
  const a = crypto.createHash('sha256').update(match[1]).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

const LOGIN_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;

function requireToken(name) {
  return (req, res, next) => {
    if (!tokenMatches(req.get('Authorization'), secret(name))) {
      logger.warn('rejected request with an invalid API token', { path: req.path });
      return res.status(401).json({ error: 'unauthorized' });
    }
    return next();
  };
}

function requireStudent(req, res, next) {
  const login = req.get('X-Remouline-Student');
  if (!LOGIN_RE.test(login ?? '')) return res.status(400).json({ error: 'missing user identity' });
  const row = db().prepare('SELECT * FROM students WHERE login = ?').get(login);
  if (!row) return res.status(401).json({ error: 'unknown account' });
  if (!row.active) return res.status(403).json({ error: 'account disabled' });
  req.student = login;
  req.studentRow = row;
  return next();
}

// Operators (OPERATOR_LOGINS) and maintainers (role stored in the database), re-checked
// on every request: a demoted maintainer loses access immediately.
function requireStaff(req, res, next) {
  const login = req.get('X-Remouline-Admin');
  const role = LOGIN_RE.test(login ?? '') ? roleOf(login) : 'student';
  if (role !== 'operator' && role !== 'maintainer') {
    logger.warn('rejected admin request from a non-staff login', { path: req.path });
    return res.status(403).json({ error: 'forbidden' });
  }
  req.admin = login;
  req.role = role;
  return next();
}

const handle = (fn) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (err) {
    if (!err.status) logger.error(`${req.method} ${req.path}: ${err.message}`);
    res.status(err.status ?? 500).json({ error: err.status ? err.message : 'internal error' });
  }
};

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '8mb' }));

app.get('/healthz', (_req, res) => res.json({ ok: true }));

const publicToken = requireToken('API_TOKEN');

// The dashboard passes the client address for brute-force limits only (kept in memory).
app.post('/v1/auth/login', publicToken, handle((req) => login({
  login: req.body?.login,
  password: req.body?.password,
  clientIp: typeof req.body?.clientIp === 'string' ? req.body.clientIp.slice(0, 64) : null,
})));

app.get('/v1/public/status', publicToken, (_req, res) => res.json({ appName: config.appName, ...getServiceState() }));
app.get('/v1/public/pages/:name', publicToken, (req, res) => {
  const page = getPage(req.params.name);
  if (!page) return res.status(404).json({ error: 'not found' });
  return res.json(page);
});

app.get('/v1/invite/:token', publicToken, (req, res) => res.json(checkInvitation(req.params.token)));
// The user chose their password in the form: nothing secret is sent back.
app.post('/v1/invite/:token/redeem', publicToken, handle((req) => redeemInvitation(req.params.token, req.body ?? {})));

app.get('/v1/reset/:token', publicToken, (req, res) => res.json(checkResetLink(req.params.token)));
app.post('/v1/reset/:token', publicToken, handle((req) => redeemResetLink(req.params.token, req.body?.password)));

app.use('/v1/student', publicToken, requireStudent, studentRouter);
app.use('/v1/admin', requireToken('ADMIN_API_TOKEN'), requireStaff, adminRouter);

app.use((req, res) => res.status(404).json({ error: 'not found' }));
app.use((err, req, res, _next) => {
  logger.error(`unhandled error on ${req.method} ${req.path}: ${err.message}`);
  res.status(err.status ?? 500).json({ error: err.expose ? err.message : 'internal error' });
});

app.listen(config.apiPort, '0.0.0.0', () => logger.info(`API listening on :${config.apiPort}`));
startRetention();
