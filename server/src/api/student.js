// User routes. EVERY query is scoped with `student = req.student`, which comes
// from the dashboard's server-verified session: editing an id in a URL can only
// ever return the caller's own data (or 404).
import express from 'express';
import { db } from '../db.js';
import { getResults } from '../results.js';
import { pushCommand } from '../push-command.js';
import { createReport, hasWorkedOn, listReports, voteReport } from '../reports.js';
import { getAccessMode, createInvitation, listInvitations, revokeInvitation, getShareQuota } from '../invitations.js';
import { roleOf, termsAccepted, acceptTerms, changePassword, exportData, deleteAccount } from '../accounts.js';
import { getServiceState } from '../service.js';
import { getTermsVersion } from '../legal.js';
import * as gitea from '../gitea.js';

export const studentRouter = express.Router();

const SUBMISSION_COLS = `id, assignment, repo_name, commit_sha, status, passed, total, message,
  attempt, created_at, started_at, finished_at, duration_ms`;

const wrap = (fn) => async (req, res) => {
  try {
    res.json(await fn(req, res));
  } catch (err) {
    res.status(err.status ?? 500).json({ error: err.status ? err.message : 'internal error' });
  }
};

studentRouter.get('/me', (req, res) => {
  res.json({
    login: req.student,
    role: roleOf(req.student),
    email: req.studentRow.email ?? null,
    createdAt: req.studentRow.created_at,
    termsAccepted: termsAccepted(req.student),
    termsVersion: getTermsVersion(),
    accessMode: getAccessMode(),
    service: getServiceState(),
    pushCommand: pushCommand(req.student),
  });
});

studentRouter.post('/terms/accept', (req, res) => {
  acceptTerms(req.student);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Account: password, export, deletion
// ---------------------------------------------------------------------------
studentRouter.post('/password', wrap(async (req) => {
  await changePassword(req.student, { current: req.body?.current, next: req.body?.next });
  return { ok: true };
}));

studentRouter.get('/export', wrap((req) => exportData(req.student)));

studentRouter.post('/delete', wrap(async (req) => {
  if (req.body?.confirm !== req.student) {
    throw Object.assign(new Error('Type your login exactly to confirm.'), { status: 400 });
  }
  if (!(await gitea.verifyPassword(req.student, String(req.body?.password ?? '')))) {
    throw Object.assign(new Error('Wrong password.'), { status: 400 });
  }
  await deleteAccount(req.student, { reason: 'requested by its owner' });
  return { ok: true };
}));

// ---------------------------------------------------------------------------
// Assignments and results
// ---------------------------------------------------------------------------
studentRouter.get('/assignments', (req, res) => {
  const rows = db()
    .prepare(
      `SELECT a.slug, a.title, a.published_at,
              (SELECT COUNT(*) FROM submissions s WHERE s.kind = 'push' AND s.student = ? AND s.assignment = a.slug) AS attempts,
              (SELECT json_object('id', s.id, 'status', s.status, 'passed', s.passed, 'total', s.total, 'created_at', s.created_at)
                 FROM submissions s WHERE s.kind = 'push' AND s.student = ? AND s.assignment = a.slug
                 ORDER BY s.id DESC LIMIT 1) AS latest
         FROM assignments a WHERE a.status = 'published' ORDER BY a.published_at DESC`,
    )
    .all(req.student, req.student)
    .map((r) => ({ ...r, latest: r.latest ? JSON.parse(r.latest) : null }));
  // A push gets its assignment once the worker has cloned it: until then it is in progress,
  // not "unrouted".
  const unrouted = db()
    .prepare(
      `SELECT ${SUBMISSION_COLS} FROM submissions
        WHERE kind = 'push' AND student = ? AND status NOT IN ('queued', 'running')
          AND (status = 'not_configured' OR assignment IS NULL
               OR assignment NOT IN (SELECT slug FROM assignments WHERE status = 'published'))
        ORDER BY id DESC LIMIT 20`,
    )
    .all(req.student);
  const inProgress = db()
    .prepare(
      `SELECT ${SUBMISSION_COLS} FROM submissions
        WHERE kind = 'push' AND student = ? AND status IN ('queued', 'running') AND assignment IS NULL
        ORDER BY id DESC LIMIT 20`,
    )
    .all(req.student);
  res.json({ assignments: rows, unrouted, inProgress });
});

studentRouter.get('/assignments/:slug', (req, res) => {
  const assignment = db()
    .prepare("SELECT slug, title, published_at FROM assignments WHERE slug = ? AND status = 'published'")
    .get(req.params.slug);
  if (!assignment) return res.status(404).json({ error: 'not found' });
  const submissions = db()
    .prepare(`SELECT ${SUBMISSION_COLS} FROM submissions WHERE kind = 'push' AND student = ? AND assignment = ? ORDER BY id DESC LIMIT 200`)
    .all(req.student, assignment.slug);
  return res.json({ assignment, submissions, pushCommand: pushCommand(req.student) });
});

studentRouter.get('/submissions/:id', (req, res) => {
  const submission = db()
    .prepare(`SELECT ${SUBMISSION_COLS} FROM submissions WHERE id = ? AND kind = 'push' AND student = ?`)
    .get(Number(req.params.id), req.student);
  if (!submission) return res.status(404).json({ error: 'not found' });
  return res.json({ submission, results: getResults(submission.id) });
});

// Test reports: visible to every user who worked on the assignment, votable, anonymous.
function publishedSlug(req, res) {
  const row = db().prepare("SELECT slug FROM assignments WHERE slug = ? AND status = 'published'").get(req.params.slug);
  if (!row) res.status(404).json({ error: 'not found' });
  return row?.slug ?? null;
}

studentRouter.get('/assignments/:slug/reports', (req, res) => {
  const slug = publishedSlug(req, res);
  if (!slug) return;
  res.json({ canParticipate: hasWorkedOn(req.student, slug), reports: listReports(slug, { viewer: req.student }) });
});

studentRouter.post('/assignments/:slug/reports', (req, res) => {
  const slug = publishedSlug(req, res);
  if (!slug) return;
  try {
    const id = createReport({ student: req.student, slug, resultId: req.body?.resultId, message: req.body?.message });
    res.status(201).json({ id });
  } catch (err) {
    res.status(err.status ?? 500).json({ error: err.message });
  }
});

studentRouter.post('/reports/:id/vote', (req, res) => {
  try {
    voteReport({ student: req.student, reportId: req.params.id, vote: req.body?.vote });
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status ?? 500).json({ error: err.message });
  }
});

// Trusted sharing: only available when an operator enabled it.
studentRouter.get('/invitations', (req, res) => {
  res.json({
    accessMode: getAccessMode(),
    quota: getShareQuota(req.student),
    invitations: listInvitations({ createdBy: req.student }).map(({ preset_login: _l, preset_email: _e, ...i }) => i),
  });
});

studentRouter.post('/invitations', (req, res) => {
  try {
    const inv = createInvitation({ createdBy: req.student, isAdmin: false, note: req.body?.note?.slice(0, 200) ?? null });
    res.json(inv);
  } catch (err) {
    res.status(err.status ?? 500).json({ error: err.message });
  }
});

studentRouter.delete('/invitations/:id', (req, res) => {
  const ok = revokeInvitation(Number(req.params.id), { by: req.student, isAdmin: false });
  res.status(ok ? 200 : 404).json({ ok });
});
