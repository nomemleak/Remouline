// Test reports: a student who believes a test is wrong reports it; every student who
// worked on the assignment sees the report and votes (agree / disagree), or opens
// another report. Maintainers resolve or reject them. Reports are anonymous for
// everyone, maintainers included: nobody but the author knows who posted one.
import { db, now, logActivity } from './db.js';

export const REPORT_STATUSES = ['open', 'resolved', 'rejected'];
const MAX_OPEN_REPORTS_PER_STUDENT = 10;
const clip = (s, n) => (s == null ? null : String(s).slice(0, n));

const httpError = (status, message) => Object.assign(new Error(message), { status });

/** Only students who pushed on the assignment can report or vote: they have seen the tests. */
export function hasWorkedOn(student, slug) {
  return Boolean(
    db().prepare("SELECT 1 FROM submissions WHERE kind = 'push' AND student = ? AND assignment = ? LIMIT 1").get(student, slug),
  );
}

export function createReport({ student, slug, resultId, message }) {
  const text = String(message ?? '').trim();
  if (text.length < 10) throw httpError(400, 'Explain in a few words why the test looks wrong (10 characters minimum).');
  if (text.length > 2000) throw httpError(400, 'The explanation is too long (2000 characters maximum).');
  const leaf = db()
    .prepare(
      `SELECT r.* FROM test_results r JOIN submissions s ON s.id = r.submission_id
        WHERE r.id = ? AND s.student = ? AND s.kind = 'push' AND s.assignment = ?`,
    )
    .get(Number(resultId), student, slug);
  if (!leaf) throw httpError(404, 'Test result not found.');
  if (!leaf.category_path.startsWith('Testsuite')) throw httpError(400, 'Only Criterion tests can be reported.');
  const open = db()
    .prepare("SELECT COUNT(*) AS n FROM test_reports WHERE author = ? AND assignment = ? AND status = 'open'")
    .get(student, slug).n;
  if (open >= MAX_OPEN_REPORTS_PER_STUDENT) throw httpError(429, `You already have ${open} open reports on this assignment.`);

  const evidence = {
    status: leaf.status,
    error_message: clip(leaf.error_message, 2000),
    expected_output: clip(leaf.expected_output, 1000),
    actual_output: clip(leaf.actual_output, 1000),
  };
  const id = db().transaction(() => {
    const info = db()
      .prepare('INSERT INTO test_reports (assignment, category_path, test_name, author, message, evidence) VALUES (?, ?, ?, ?, ?, ?)')
      .run(slug, leaf.category_path, leaf.test_name, student, text, JSON.stringify(evidence));
    db().prepare('INSERT INTO test_report_votes (report_id, student, vote) VALUES (?, ?, 1)').run(info.lastInsertRowid, student);
    return Number(info.lastInsertRowid);
  })();
  logActivity('report', { student, assignment: slug, detail: `reported ${leaf.category_path}/${leaf.test_name} (#${id})` });
  return id;
}

export function voteReport({ student, reportId, vote }) {
  const report = db().prepare('SELECT * FROM test_reports WHERE id = ?').get(Number(reportId));
  if (!report || !hasWorkedOn(student, report.assignment)) throw httpError(404, 'Report not found.');
  if (report.status !== 'open') throw httpError(409, 'This report is closed.');
  const v = Number(vote);
  if (![1, -1, 0].includes(v)) throw httpError(400, 'vote must be 1, -1 or 0.');
  if (v === 0) {
    db().prepare('DELETE FROM test_report_votes WHERE report_id = ? AND student = ?').run(report.id, student);
  } else {
    db()
      .prepare(
        `INSERT INTO test_report_votes (report_id, student, vote) VALUES (?, ?, ?)
         ON CONFLICT(report_id, student) DO UPDATE SET vote = excluded.vote, created_at = excluded.created_at`,
      )
      .run(report.id, student, v);
  }
}

/** Nobody sees who reported or voted: only the author knows a report is theirs. */
export function listReports(slug, { viewer = null } = {}) {
  const rows = db()
    .prepare(
      `SELECT t.*,
              COALESCE(SUM(CASE WHEN v.vote = 1 THEN 1 END), 0) AS agree,
              COALESCE(SUM(CASE WHEN v.vote = -1 THEN 1 END), 0) AS disagree,
              MAX(CASE WHEN v.student = ? THEN v.vote END) AS my_vote
         FROM test_reports t LEFT JOIN test_report_votes v ON v.report_id = t.id
        WHERE t.assignment = ?
        GROUP BY t.id
        ORDER BY CASE t.status WHEN 'open' THEN 0 ELSE 1 END, t.id DESC`,
    )
    .all(viewer, slug);
  return rows.map(({ author, ...r }) => ({ ...r, evidence: r.evidence ? JSON.parse(r.evidence) : null, mine: author === viewer }));
}

export function setReportStatus(id, { status, note }, maintainer) {
  if (!REPORT_STATUSES.includes(status)) throw httpError(400, `status must be one of ${REPORT_STATUSES.join(', ')}`);
  const report = db().prepare('SELECT * FROM test_reports WHERE id = ?').get(Number(id));
  if (!report) throw httpError(404, 'Report not found.');
  db()
    .prepare('UPDATE test_reports SET status = ?, admin_note = ?, closed_at = ? WHERE id = ?')
    .run(status, clip(note, 2000), status === 'open' ? null : now(), report.id);
  logActivity('admin_action', { student: maintainer, assignment: report.assignment, detail: `report #${report.id} marked ${status}` });
}
