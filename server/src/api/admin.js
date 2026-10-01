// Admin routes (admin panel). Access: ADMIN_API_TOKEN + an operator or maintainer
// login, re-checked on every request by api/server.js. Each route declares who may
// use it:
//   operator    accounts, access, logs, settings, pause; unpublish/delete (takedown)
//   maintainer  testsuites (import, validation, publishing) and students' reports,
//               without ever seeing who the students are
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { config } from '../config.js';
import { db, now, logActivity } from '../db.js';
import { createLogger } from '../logger.js';
import * as gitea from '../gitea.js';
import {
  dirs, isValidSlug, replaceFolder, mergeIntoFolder, listFiles, readTextFiles, publishStagingTests, getAssignment,
  deleteAssignmentFiles,
} from '../assignments.js';
import { previewTests } from '../criterion-parser.js';
import { getResults } from '../results.js';
import { enqueueSubmission } from '../queue.js';
import { startValidation, canValidate, REFERENCE_STUDENT } from '../validation.js';
import { listReports, setReportStatus } from '../reports.js';
import { parseFlagList, parseFlagsFile, normalizeOverrides, freezeConfig, draftFlagsDiffer, storedOverrides } from '../flags.js';
import { pushCommand } from '../push-command.js';
import {
  ACCESS_MODES, getAccessMode, setAccessMode, createInvitation, listInvitations, revokeInvitation,
  revokePendingInvitationsOf, countSharesOf, getMaxInvitesPerStudent, setMaxInvitesPerStudent,
} from '../invitations.js';
import { createResetLink, deleteAccount, newMaintainerLogin } from '../accounts.js';
import { ATTESTATION_TEXT, ATTESTATION_VERSION, PAGES, getPageSource, savePage, getContact, setContact, getTermsVersion } from '../legal.js';
import { getServiceState, setServicePaused } from '../service.js';

const logger = createLogger('admin');
export const adminRouter = express.Router();

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const fail = (res, status, error) => res.status(status).json({ error });
const audit = (admin, detail, extra = {}) => logActivity('admin_action', { student: admin, detail, ...extra });
const ROLE_MESSAGES = {
  operator: 'Only an operator can do this.',
  maintainer: 'Only a maintainer can do this: testsuites are managed by maintainer accounts.',
};
const only = (...roles) => (req, res, next) => (roles.includes(req.role) ? next() : fail(res, 403, ROLE_MESSAGES[roles[0]]));
const operator = only('operator');
const maintainer = only('maintainer');

function contentHash(...folders) {
  const hash = crypto.createHash('sha256');
  for (const [index, folder] of folders.entries()) {
    hash.update(`#${index}\n`);
    for (const rel of listFiles(folder)) {
      hash.update(`${rel}\n`);
      hash.update(fs.readFileSync(path.join(folder, rel)));
    }
  }
  return hash.digest('hex');
}

function loadAssignment(req, res) {
  if (!isValidSlug(req.params.slug)) {
    fail(res, 400, 'invalid slug');
    return null;
  }
  const assignment = getAssignment(req.params.slug);
  if (!assignment) fail(res, 404, 'assignment not found');
  return assignment;
}

// Operators only get the summary: testsuites are the maintainers' business.
function assignmentSummary(assignment) {
  const { slug, title, status, validation_status, created_at, published_at } = assignment;
  return { assignment: { slug, title, status, validation_status, created_at, published_at } };
}

function assignmentPayload(assignment, role = 'maintainer') {
  if (role !== 'maintainer') return assignmentSummary(assignment);
  const d = dirs(assignment.slug);
  const staging = readTextFiles(d.staging);
  const { published_config: _frozen, ...fields } = assignment;
  return {
    assignment: {
      ...fields,
      validation_report: assignment.validation_report ? JSON.parse(assignment.validation_report) : null,
    },
    stagingFiles: staging,
    headerFiles: readTextFiles(d.headers),
    stubFiles: readTextFiles(d.stub),
    stubOtherFiles: readTextFiles(d.stubOther),
    defaultCompileFlags: config.defaultCompileFlags,
    ignoredFlagLines: storedOverrides(assignment.flag_overrides).ignored,
    attestation: { version: ATTESTATION_VERSION, text: ATTESTATION_TEXT },
    publishedFiles: listFiles(d.tests),
    preview: previewTests(staging),
    stagingDiffersFromPublished: contentHash(d.staging) !== contentHash(d.tests) || draftFlagsDiffer(assignment),
  };
}

// What a validation certifies: the tests, the headers AND the compilation flags.
function validationHash(slug) {
  const d = dirs(slug);
  const a = getAssignment(slug);
  const flags = crypto.createHash('sha256').update(`${a?.compile_flags ?? ''}\n${a?.flag_overrides ?? ''}`).digest('hex');
  return `${contentHash(d.staging, d.headers)}:${flags}`;
}

async function maybeRevalidate(slug) {
  if (canValidate(slug)) {
    const report = await startValidation(slug);
    const hash = validationHash(slug);
    db().prepare('UPDATE assignments SET validation_report = ? WHERE slug = ?').run(JSON.stringify({ ...report, contentHash: hash }), slug);
    return true;
  }
  db().prepare("UPDATE assignments SET validation_status = 'none', validation_report = NULL WHERE slug = ?").run(slug);
  return false;
}

// ---------------------------------------------------------------------------
// Overview + assignments
// ---------------------------------------------------------------------------
adminRouter.get('/overview', (req, res) => {
  const service = getServiceState();
  const assignments = db()
    .prepare(
      `SELECT a.slug, a.title, a.status, a.validation_status, a.published_at, a.created_at,
              (SELECT COUNT(*) FROM submissions s WHERE s.kind = 'push' AND s.assignment = a.slug) AS submissions,
              (SELECT COUNT(DISTINCT s.student) FROM submissions s WHERE s.kind = 'push' AND s.assignment = a.slug) AS students,
              (SELECT MAX(s.created_at) FROM submissions s WHERE s.kind = 'push' AND s.assignment = a.slug) AS last_push,
              (SELECT COUNT(*) FROM test_reports r WHERE r.assignment = a.slug AND r.status = 'open') AS open_reports
         FROM assignments a ORDER BY a.created_at DESC`,
    )
    .all();
  // Aggregates only for maintainers: no student login ever reaches them.
  if (req.role !== 'operator') return res.json({ role: req.role, assignments, service });
  const unrouted = db()
    .prepare(
      `SELECT id, student, assignment, repo_name, status, message, created_at FROM submissions
        WHERE kind = 'push' AND status = 'not_configured' ORDER BY id DESC LIMIT 50`,
    )
    .all();
  const infraErrors = db()
    .prepare(
      `SELECT id, student, assignment, status, message, created_at FROM submissions
        WHERE status IN ('infra_error', 'timeout') ORDER BY id DESC LIMIT 20`,
    )
    .all();
  const queue = db()
    .prepare("SELECT status, COUNT(*) AS n FROM submissions WHERE status IN ('queued', 'running') GROUP BY status")
    .all();
  return res.json({ role: req.role, assignments, unrouted, infraErrors, queue, accessMode: getAccessMode(), service });
});

adminRouter.post('/assignments', maintainer, (req, res) => {
  const { slug, title } = req.body ?? {};
  if (!isValidSlug(slug)) return fail(res, 400, 'The slug must match the assignment folder exactly (letters, digits, ".", "_", "-").');
  if (getAssignment(slug)) return fail(res, 409, 'This assignment already exists.');
  // Server fallback until the bundle (remouline/flags.txt) or a maintainer sets the flags.
  const flags = parseFlagList(config.defaultCompileFlags).join(' ');
  db()
    .prepare("INSERT INTO assignments (slug, title, compile_flags, flags_source) VALUES (?, ?, ?, 'fallback')")
    .run(slug, title?.trim() || slug, flags);
  fs.mkdirSync(dirs(slug).base, { recursive: true });
  audit(req.admin, `created assignment ${slug}`, { assignment: slug });
  return res.status(201).json(assignmentPayload(getAssignment(slug)));
});

adminRouter.get('/assignments/:slug', (req, res) => {
  const assignment = loadAssignment(req, res);
  if (assignment) res.json(assignmentPayload(assignment, req.role));
});

adminRouter.patch('/assignments/:slug', maintainer, wrap(async (req, res) => {
  const assignment = loadAssignment(req, res);
  if (!assignment) return;
  const body = req.body ?? {};
  if (typeof body.title === 'string') {
    db().prepare('UPDATE assignments SET title = ? WHERE slug = ?').run(body.title.trim() || assignment.slug, assignment.slug);
  }
  if (typeof body.compile_flags === 'string' || typeof body.flag_overrides === 'string') {
    let flags;
    let overrides;
    try {
      flags = typeof body.compile_flags === 'string' ? parseFlagList(body.compile_flags).join(' ') : assignment.compile_flags;
      overrides = typeof body.flag_overrides === 'string' ? normalizeOverrides(body.flag_overrides) : assignment.flag_overrides;
    } catch (err) {
      return fail(res, 400, err.message);
    }
    if (!flags) return fail(res, 400, 'The default compilation flags cannot be empty.');
    db()
      .prepare("UPDATE assignments SET compile_flags = ?, flag_overrides = ?, flags_source = 'admin' WHERE slug = ?")
      .run(flags, overrides || null, assignment.slug);
    audit(req.admin, `compilation flags of ${assignment.slug}: ${flags}${overrides ? ` (+ exceptions)` : ''}`, { assignment: assignment.slug });
    await maybeRevalidate(assignment.slug); // flags change what compiles: validate again
  }
  res.json(assignmentPayload(getAssignment(assignment.slug)));
}));

function validateFiles(files, { testsOnly }) {
  if (!Array.isArray(files) || files.length === 0) return 'No files received.';
  for (const f of files) {
    if (typeof f?.path !== 'string' || typeof f?.content !== 'string') return 'Each file needs a path and a content.';
    if (testsOnly && !/\.(c|h)$/.test(f.path)) return `Only .c/.h test files are accepted (${f.path}).`;
  }
  return null;
}

// One import of a testsuite bundle (docs/BUNDLE-FORMAT.md) = Criterion tests + headers
// (+ optional remouline/flags.txt), then one validation run against the generated
// empty implementations. mode "merge" only adds/overwrites the given files (fix
// iterations), "replace" replaces each group. The maintainer's attestation is required
// and recorded server-side only.
adminRouter.put('/assignments/:slug/bundle', maintainer, wrap(async (req, res) => {
  const assignment = loadAssignment(req, res);
  if (!assignment) return;
  if (req.body?.attest !== true) {
    return fail(res, 400, 'Confirm that you have the right to use the material these tests are derived from.');
  }
  const { tests = [], headers = [], mode = 'merge', flags = null } = req.body ?? {};
  if (![tests, headers].every(Array.isArray)) return fail(res, 400, 'tests and headers must be arrays.');
  if (tests.length + headers.length === 0 && !flags) return fail(res, 400, 'No files received.');
  // Optional "remouline/flags.txt" in the bundle: default flags + per-exercise exceptions.
  let parsedFlags = null;
  if (typeof flags === 'string' && flags.trim()) {
    try {
      parsedFlags = parseFlagsFile(flags);
    } catch (err) {
      return fail(res, 400, `remouline/flags.txt: ${err.message}`);
    }
  }
  if (tests.length) {
    const problem = validateFiles(tests, { testsOnly: true });
    if (problem) return fail(res, 400, problem);
  }
  if (headers.length) {
    const problem = validateFiles(headers, { testsOnly: false });
    if (problem) return fail(res, 400, problem);
    const notHeader = headers.find((f) => !f.path.endsWith('.h'));
    if (notHeader) return fail(res, 400, `Only .h files are accepted as headers (${notHeader.path}).`);
  }
  const d = dirs(assignment.slug);
  try {
    for (const [target, files] of [[d.staging, tests], [d.headers, headers]]) {
      if (files.length === 0) continue;
      if (mode === 'replace') replaceFolder(target, files);
      else mergeIntoFolder(target, files);
    }
  } catch (err) {
    return fail(res, 400, err.message);
  }
  if (tests.length) db().prepare('UPDATE assignments SET tests_version = tests_version + 1 WHERE slug = ?').run(assignment.slug);
  if (parsedFlags) {
    db()
      .prepare(
        `UPDATE assignments SET compile_flags = COALESCE(?, compile_flags), flag_overrides = ?,
           flags_source = CASE WHEN ? IS NULL THEN flags_source ELSE 'bundle' END WHERE slug = ?`,
      )
      .run(parsedFlags.defaultFlags, parsedFlags.overrides || null, parsedFlags.defaultFlags, assignment.slug);
  }
  db()
    .prepare('INSERT INTO testsuite_attestations (assignment, maintainer, statement_version, content_hash) VALUES (?, ?, ?, ?)')
    .run(assignment.slug, req.admin, ATTESTATION_VERSION, validationHash(assignment.slug));
  audit(req.admin, `imported ${tests.length} test file(s) and ${headers.length} header(s) for ${assignment.slug} (${mode})${parsedFlags ? ' + compilation flags' : ''}`, { assignment: assignment.slug });
  await maybeRevalidate(assignment.slug);
  res.json(assignmentPayload(getAssignment(assignment.slug)));
}));

adminRouter.post('/assignments/:slug/validate', maintainer, wrap(async (req, res) => {
  const assignment = loadAssignment(req, res);
  if (!assignment) return;
  if (!(await maybeRevalidate(assignment.slug))) return fail(res, 400, 'Import the tests first.');
  res.json(assignmentPayload(getAssignment(assignment.slug)));
}));

// Permanent deletion: assignment, its files, every submission/result and report.
adminRouter.post('/assignments/:slug/delete', (req, res) => {
  const assignment = loadAssignment(req, res);
  if (!assignment) return;
  if (req.body?.confirm !== assignment.slug) return fail(res, 400, 'Type the exact assignment slug to confirm the deletion.');
  const counts = db().transaction(() => {
    const subs = db().prepare('DELETE FROM submissions WHERE assignment = ?').run(assignment.slug).changes;
    const reports = db().prepare('DELETE FROM test_reports WHERE assignment = ?').run(assignment.slug).changes;
    db().prepare('DELETE FROM activity_log WHERE assignment = ?').run(assignment.slug);
    db().prepare('DELETE FROM assignments WHERE slug = ?').run(assignment.slug);
    return { subs, reports };
  })();
  deleteAssignmentFiles(assignment.slug);
  audit(req.admin, `deleted assignment ${assignment.slug} (${counts.subs} submission(s), ${counts.reports} report(s))`);
  logger.warn(`assignment ${assignment.slug} deleted`, counts);
  res.json({ ok: true, ...counts });
});

adminRouter.post('/assignments/:slug/publish', maintainer, (req, res) => {
  const assignment = loadAssignment(req, res);
  if (!assignment) return;
  const d = dirs(assignment.slug);
  const report = assignment.validation_report ? JSON.parse(assignment.validation_report) : null;
  // "Publish anyway": explicit override after a failed validation (false positives
  // exist, e.g. a function whose only requirement is to not crash on NULL).
  const force = req.body?.force === true && assignment.validation_status === 'failed';
  if ((assignment.validation_status !== 'passed' && !force) || !report) {
    return fail(res, 409, 'Publishing is blocked until the validation passes.');
  }
  if (report.contentHash !== validationHash(assignment.slug)) {
    return fail(res, 409, 'Files changed since the last validation. Re-run the validation first.');
  }
  // Students are graded with the validated tests AND the flags they were validated with.
  const frozen = JSON.stringify(freezeConfig(assignment, getResults(report.stubSubmissionId)));
  publishStagingTests(assignment.slug);
  db()
    .prepare("UPDATE assignments SET status = 'published', published_at = COALESCE(published_at, ?), published_config = ? WHERE slug = ?")
    .run(now(), frozen, assignment.slug);
  audit(req.admin, `published ${assignment.slug}${force ? ` DESPITE a failed validation (${report.blocking?.length ?? 0} problem(s))` : ''}`, { assignment: assignment.slug });
  res.json(assignmentPayload(getAssignment(assignment.slug)));
});

adminRouter.post('/assignments/:slug/unpublish', (req, res) => {
  const assignment = loadAssignment(req, res);
  if (!assignment) return;
  db().prepare("UPDATE assignments SET status = 'draft' WHERE slug = ?").run(assignment.slug);
  audit(req.admin, `unpublished ${assignment.slug}`, { assignment: assignment.slug });
  res.json(assignmentPayload(getAssignment(assignment.slug), req.role));
});

// Activity feed of ONE assignment: submissions, filterable by student / status / free text.
adminRouter.get('/assignments/:slug/feed', operator, (req, res) => {
  const assignment = loadAssignment(req, res);
  if (!assignment) return;
  const where = ["kind = 'push'", 'assignment = ?'];
  const params = [assignment.slug];
  if (req.query.student) { where.push('student = ?'); params.push(String(req.query.student)); }
  if (req.query.status) { where.push('status = ?'); params.push(String(req.query.status)); }
  if (req.query.q) {
    where.push('(student LIKE ? OR repo_name LIKE ? OR commit_sha LIKE ? OR message LIKE ?)');
    const like = `%${String(req.query.q)}%`;
    params.push(like, like, like, like);
  }
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const rows = db()
    .prepare(
      `SELECT id, student, repo_name, commit_sha, status, passed, total, message, attempt, created_at, duration_ms
         FROM submissions WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset);
  const students = db()
    .prepare("SELECT DISTINCT student FROM submissions WHERE kind = 'push' AND assignment = ? ORDER BY student")
    .all(assignment.slug)
    .map((r) => r.student);
  const events = db()
    .prepare('SELECT * FROM activity_log WHERE assignment = ? ORDER BY id DESC LIMIT 100')
    .all(assignment.slug);
  res.json({ submissions: rows, students, events });
});

// ---------------------------------------------------------------------------
// Test reports
// ---------------------------------------------------------------------------
adminRouter.get('/assignments/:slug/reports', maintainer, (req, res) => {
  const assignment = loadAssignment(req, res);
  if (assignment) res.json({ reports: listReports(assignment.slug) });
});

// Neutral JSON exports, to work on a testsuite with any external tool.
function exportFiles(slug) {
  const d = dirs(slug);
  const tests = readTextFiles(d.staging);
  return { preview: previewTests(tests).tests, files: { tests, headers: readTextFiles(d.headers) } };
}

const exportedResult = (r) => ({
  category_path: r.category_path, test_name: r.test_name, status: r.status,
  error_message: r.error_message, raw_output: r.raw_output, valgrind_ok: r.valgrind_ok,
});

adminRouter.get('/assignments/:slug/export/validation', maintainer, (req, res) => {
  const assignment = loadAssignment(req, res);
  if (!assignment) return;
  const report = assignment.validation_report ? JSON.parse(assignment.validation_report) : null;
  if (!report?.stubSubmissionId) return fail(res, 404, 'No validation to export yet.');
  const resultsOf = (id) => (id ? getResults(id).map(exportedResult) : []);
  res.json({
    format: 'remouline-validation-report',
    version: 1,
    assignment: assignment.slug,
    exportedAt: now(),
    validation: {
      status: assignment.validation_status,
      blocking: report.blocking ?? [],
      warnings: report.warnings ?? [],
      voidFunctions: report.voidFunctions ?? [],
    },
    results: { zero: resultsOf(report.stubSubmissionId), other: resultsOf(report.otherSubmissionId) },
    ...exportFiles(assignment.slug),
  });
});

adminRouter.get('/assignments/:slug/export/reports', maintainer, (req, res) => {
  const assignment = loadAssignment(req, res);
  if (!assignment) return;
  res.json({
    format: 'remouline-reports',
    version: 1,
    assignment: assignment.slug,
    exportedAt: now(),
    reports: listReports(assignment.slug).map(({ my_vote: _v, mine: _m, ...r }) => r),
    ...exportFiles(assignment.slug),
  });
});

adminRouter.post('/reports/:id/status', maintainer, (req, res) => {
  try {
    setReportStatus(req.params.id, { status: req.body?.status, note: req.body?.note }, req.admin);
    res.json({ ok: true });
  } catch (err) {
    fail(res, err.status ?? 500, err.message);
  }
});

// ---------------------------------------------------------------------------
// Submissions
// ---------------------------------------------------------------------------
// Maintainers only reach validation runs (empty implementations), never a student's
// push; operators only reach pushes.
function visibleSubmission(req) {
  const submission = db().prepare('SELECT * FROM submissions WHERE id = ?').get(Number(req.params.id));
  if (!submission) return null;
  if (req.role === 'maintainer' && submission.kind !== 'validation') return null;
  if (req.role === 'operator' && submission.kind !== 'push') return null;
  return submission;
}

adminRouter.get('/submissions/:id', (req, res) => {
  const submission = visibleSubmission(req);
  if (!submission) return fail(res, 404, 'not found');
  res.json({ submission, results: getResults(submission.id) });
});

adminRouter.post('/submissions/:id/rerun', wrap(async (req, res) => {
  const submission = visibleSubmission(req);
  if (!submission) return fail(res, 404, 'not found');
  if (['queued', 'running'].includes(submission.status)) return fail(res, 409, 'Already queued or running.');
  const attempt = submission.attempt + 1;
  db().transaction(() => {
    db().prepare('DELETE FROM test_results WHERE submission_id = ?').run(submission.id);
    db()
      .prepare(
        `UPDATE submissions SET status = 'queued', attempt = ?, passed = NULL, total = NULL, message = NULL,
           job_log = NULL, started_at = NULL, finished_at = NULL, duration_ms = NULL WHERE id = ?`,
      )
      .run(attempt, submission.id);
  })();
  const payload = submission.kind === 'validation'
    ? { type: 'validation', submissionId: submission.id, slug: submission.assignment, role: submission.validation_role, attempt }
    : { type: 'push', submissionId: submission.id, attempt };
  await enqueueSubmission(payload);
  audit(req.admin, `re-ran submission #${submission.id}`, { assignment: submission.assignment });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// Students & access (operators only; driven through the Gitea API)
// ---------------------------------------------------------------------------
const STUDENT_ROLE = "st.role = 'student'";

adminRouter.get('/students', operator, (req, res) => {
  const students = db()
    .prepare(
      `SELECT st.login, st.email, st.active, st.created_via, st.invited_by, st.created_at, st.last_login_at, st.terms_accepted_at,
              (SELECT COUNT(*) FROM submissions s WHERE s.kind = 'push' AND s.student = st.login) AS submissions,
              (SELECT MAX(s.created_at) FROM submissions s WHERE s.kind = 'push' AND s.student = st.login) AS last_push
         FROM students st WHERE ${STUDENT_ROLE} AND st.login != ? ORDER BY st.login`,
    )
    .all(REFERENCE_STUDENT);
  res.json({ students, accessMode: getAccessMode() });
});

adminRouter.get('/students/:login', operator, wrap(async (req, res) => {
  const student = db().prepare(`SELECT * FROM students st WHERE ${STUDENT_ROLE} AND login = ?`).get(req.params.login);
  if (!student) return fail(res, 404, 'not found');
  const [giteaUser, repos] = await Promise.all([
    gitea.getUser(student.login).catch((e) => ({ error: e.message })),
    gitea.listUserRepos(student.login).catch(() => []),
  ]);
  const assignments = db()
    .prepare(
      `SELECT assignment, COUNT(*) AS attempts, MAX(created_at) AS last_push FROM submissions
        WHERE kind = 'push' AND student = ? GROUP BY assignment ORDER BY last_push DESC`,
    )
    .all(student.login);
  const invitees = db().prepare('SELECT login, active, created_at FROM students WHERE invited_by = ?').all(student.login);
  res.json({
    student,
    gitea: giteaUser?.error ? { error: giteaUser.error } : { prohibit_login: giteaUser.prohibit_login, created: giteaUser.created },
    repos: repos.map((r) => ({ name: r.name, private: r.private, updated_at: r.updated_at })),
    assignments,
    invitees,
    pushCommand: pushCommand(student.login),
  });
}));

// The ONE way to invite students. With a login (and optionally an email): personal
// link, both fixed. With neither: open link (the person chooses them). Either way the
// person chooses their password on the link; no password ever goes through the operator.
function personalInvitation(admin, login, email, ttlDays, note = null) {
  const hours = Math.min(Math.max(Number(ttlDays) || 14, 1), 60) * 24;
  if (!login && !email) {
    try {
      const inv = createInvitation({ createdBy: admin, isAdmin: true, ttlHours: hours, note: note || null });
      return { login: null, email: null, open: true, token: inv.token, expiresAt: inv.expiresAt };
    } catch (err) {
      return { login: null, email: null, error: err.message };
    }
  }
  if (!login) return { login, email, error: 'an email needs a login (personal link); leave both empty for an open link' };
  if (db().prepare('SELECT 1 FROM students WHERE login = ?').get(login)) {
    return { login, email, error: 'already has an account' };
  }
  // A new link for the same person replaces the previous unused one.
  db()
    .prepare('UPDATE invitations SET revoked_at = ? WHERE preset_login = ? AND used_at IS NULL AND revoked_at IS NULL')
    .run(now(), login);
  try {
    const inv = createInvitation({
      createdBy: admin, isAdmin: true, presetLogin: login, presetEmail: email || null, ttlHours: hours, note: note || `personal link for ${login}`,
    });
    return { login, email, token: inv.token, expiresAt: inv.expiresAt };
  } catch (err) {
    return { login, email, error: err.message };
  }
}

adminRouter.post('/students', operator, (req, res) => {
  const { login, email, ttlDays, note } = req.body ?? {};
  const note_ = typeof note === 'string' ? note.trim().slice(0, 200) : null;
  const result = personalInvitation(req.admin, String(login ?? '').trim(), String(email ?? '').trim(), ttlDays, note_);
  if (!result.error) audit(req.admin, result.open ? 'open invitation link created' : `personal invitation for ${result.login}`);
  res.status(result.error ? 400 : 201).json({ invitations: [result], error: result.error });
});

// CSV: "login[,email]" per line (a header line is accepted and skipped).
adminRouter.post('/students/bulk', operator, (req, res) => {
  const lines = String(req.body?.csv ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const results = [];
  for (const line of lines) {
    const [login, email] = line.split(/[,;\t]/).map((s) => s?.trim());
    if (!login || login.toLowerCase() === 'login') continue;
    results.push(personalInvitation(req.admin, login, email, req.body?.ttlDays));
  }
  audit(req.admin, `bulk invitations: ${results.filter((r) => !r.error).length} created, ${results.filter((r) => r.error).length} refused`);
  res.json({ invitations: results });
});

adminRouter.post('/students/:login/active', operator, wrap(async (req, res) => {
  const active = Boolean(req.body?.active);
  const { login } = req.params;
  const student = db().prepare("SELECT * FROM students WHERE login = ? AND role IN ('student', 'maintainer')").get(login);
  if (!student) return fail(res, 404, 'not found');
  await gitea.setLoginAllowed(login, active);
  db().prepare('UPDATE students SET active = ? WHERE login = ?').run(active ? 1 : 0, login);
  if (!active) revokePendingInvitationsOf(login);
  audit(req.admin, `${active ? 'enabled' : 'disabled'} account ${login}`);
  res.json({ ok: true });
}));

// A lost password: single-use link where the person chooses a new one.
adminRouter.post('/students/:login/reset-link', operator, (req, res) => {
  const student = db().prepare("SELECT login FROM students WHERE login = ? AND role IN ('student', 'maintainer')").get(req.params.login);
  if (!student) return fail(res, 404, 'not found');
  res.json(createResetLink(student.login, req.admin));
});

adminRouter.post('/students/:login/delete', operator, wrap(async (req, res) => {
  const student = db().prepare("SELECT login FROM students WHERE login = ? AND role IN ('student', 'maintainer')").get(req.params.login);
  if (!student) return fail(res, 404, 'not found');
  if (req.body?.confirm !== student.login) return fail(res, 400, 'Type the exact login to confirm the deletion.');
  await deleteAccount(student.login, { reason: 'deleted by an operator' });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// Maintainers (operators only): pseudonymous accounts that import testsuites.
// ---------------------------------------------------------------------------
adminRouter.get('/maintainers', operator, (req, res) => {
  const maintainers = db()
    .prepare("SELECT login, active, created_at, last_login_at FROM students WHERE role = 'maintainer' ORDER BY created_at")
    .all();
  const invitations = listInvitations({ role: 'maintainer' }).map(({ preset_email: _e, ...i }) => i);
  res.json({ maintainers, invitations });
});

adminRouter.post('/maintainers', operator, (req, res) => {
  const login = newMaintainerLogin();
  const hours = Math.min(Math.max(Number(req.body?.ttlDays) || 7, 1), 60) * 24;
  const inv = createInvitation({ createdBy: req.admin, isAdmin: true, presetLogin: login, role: 'maintainer', ttlHours: hours, note: 'maintainer' });
  audit(req.admin, `maintainer invitation for ${login}`);
  res.status(201).json({ login, token: inv.token, expiresAt: inv.expiresAt });
});

// ---------------------------------------------------------------------------
// Access mode & invitations
// ---------------------------------------------------------------------------
adminRouter.get('/access', operator, (req, res) => {
  const invitations = listInvitations({ role: 'student' });
  const tree = db()
    .prepare(`SELECT login, invited_by, active, created_via, created_at FROM students st WHERE ${STUDENT_ROLE} AND login != ? ORDER BY created_at`)
    .all(REFERENCE_STUDENT)
    .map((s) => ({ ...s, shares: countSharesOf(s.login) }));
  res.json({
    accessMode: getAccessMode(),
    modes: ACCESS_MODES,
    maxInvitesPerStudent: getMaxInvitesPerStudent(),
    invitations,
    tree,
    inviteTtlHours: config.inviteTtlHours,
  });
});

// Lowering the limit never revokes existing accounts or links (see invitations.js).
adminRouter.post('/access/max-invites', operator, (req, res) => {
  try {
    setMaxInvitesPerStudent(req.body?.value, req.admin);
    res.json({ maxInvitesPerStudent: getMaxInvitesPerStudent() });
  } catch (err) {
    fail(res, err.status ?? 400, err.message);
  }
});

adminRouter.post('/access/mode', operator, (req, res) => {
  try {
    setAccessMode(req.body?.mode, req.admin);
    res.json({ accessMode: getAccessMode() });
  } catch (err) {
    fail(res, 400, err.message);
  }
});

// Invitations are created from Students (POST /students); Access only lists and revokes them.
adminRouter.delete('/access/invitations/:id', operator, (req, res) => {
  const ok = revokeInvitation(Number(req.params.id), { by: req.admin, isAdmin: true });
  if (ok) audit(req.admin, `revoked invitation #${req.params.id}`);
  res.status(ok ? 200 : 404).json({ ok });
});

// ---------------------------------------------------------------------------
// Logs & activity
// ---------------------------------------------------------------------------
adminRouter.get('/logs', operator, (req, res) => {
  const where = [];
  const params = [];
  if (req.query.service) { where.push('service = ?'); params.push(String(req.query.service)); }
  if (req.query.level) { where.push('level = ?'); params.push(String(req.query.level)); }
  if (req.query.q) { where.push('(message LIKE ? OR context LIKE ?)'); params.push(`%${req.query.q}%`, `%${req.query.q}%`); }
  if (req.query.before) { where.push('id < ?'); params.push(Number(req.query.before)); }
  const rows = db()
    .prepare(`SELECT * FROM service_logs ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT 300`)
    .all(...params);
  res.json({ logs: rows });
});

adminRouter.get('/activity', operator, (req, res) => {
  const rows = db().prepare('SELECT * FROM activity_log ORDER BY id DESC LIMIT 300').all();
  res.json({ events: rows });
});

// ---------------------------------------------------------------------------
// Settings (operators only): emergency pause, contact, terms / privacy / legal pages
// ---------------------------------------------------------------------------
adminRouter.get('/settings', operator, (req, res) => {
  res.json({
    service: getServiceState(),
    contact: getContact(),
    termsVersion: getTermsVersion(),
    pages: Object.fromEntries(PAGES.map((name) => [name, getPageSource(name)])),
    retention: {
      dataDays: config.dataRetentionDays,
      accountDays: config.accountRetentionDays,
      logDays: config.logRetentionDays,
      backupDays: config.backupRetentionDays,
    },
  });
});

adminRouter.post('/settings/service', operator, (req, res) => {
  setServicePaused(req.body?.paused === true, req.body?.message, req.admin);
  res.json({ service: getServiceState() });
});

adminRouter.post('/settings/contact', operator, (req, res) => {
  try {
    setContact(req.body?.contact, req.admin);
    res.json({ contact: getContact() });
  } catch (err) {
    fail(res, err.status ?? 400, err.message);
  }
});

adminRouter.put('/settings/pages/:name', operator, (req, res) => {
  try {
    const termsVersion = savePage(req.params.name, req.body?.text, req.admin, { reset: req.body?.reset === true });
    res.json({ text: getPageSource(req.params.name), termsVersion });
  } catch (err) {
    fail(res, err.status ?? 400, err.message);
  }
});
