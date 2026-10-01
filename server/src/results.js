// Persistence of correction reports + submission state transitions.
import { db, now } from './db.js';

export const PASSING = 'pass';

// A leaf counts as passed only if it passed AND the memory check (LeakSanitizer or valgrind) did not flag it.
export function leafPassed(leaf) {
  return leaf.status === PASSING && leaf.valgrind_ok !== 0 && leaf.valgrind_ok !== false;
}

export function getSubmission(id) {
  return db().prepare('SELECT * FROM submissions WHERE id = ?').get(id);
}

export function markRunning(id) {
  db()
    .prepare("UPDATE submissions SET status = 'running', started_at = ?, message = NULL WHERE id = ?")
    .run(now(), id);
}

export function setWaitingMessage(id, message) {
  db().prepare("UPDATE submissions SET status = 'queued', message = ? WHERE id = ?").run(message, id);
}

export function setAssignment(id, slug) {
  db().prepare('UPDATE submissions SET assignment = ? WHERE id = ?').run(slug, id);
}

export function finishSubmission(id, { status, message = null, jobLog = null, passed = null, total = null }) {
  const sub = getSubmission(id);
  const finished = now();
  const duration = sub?.started_at ? Date.parse(finished) - Date.parse(sub.started_at) : null;
  db()
    .prepare(
      `UPDATE submissions
         SET status = ?, message = ?, job_log = ?, passed = ?, total = ?, finished_at = ?, duration_ms = ?
       WHERE id = ?`,
    )
    .run(status, message, jobLog, passed, total, finished, duration, id);
}

export function saveReport(id, report) {
  const leaves = Array.isArray(report.results) ? report.results : [];
  const insert = db().prepare(
    `INSERT INTO test_results
       (submission_id, position, category_path, test_name, status, actual_output, expected_output,
        error_message, raw_output, valgrind_ok, valgrind_details, duration_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const tx = db().transaction(() => {
    db().prepare('DELETE FROM test_results WHERE submission_id = ?').run(id);
    leaves.forEach((leaf, index) => {
      insert.run(
        id,
        index,
        String(leaf.category_path),
        String(leaf.test_name),
        String(leaf.status),
        leaf.actual_output ?? null,
        leaf.expected_output ?? null,
        leaf.error_message ?? null,
        leaf.raw_output ?? null,
        leaf.valgrind_ok === null || leaf.valgrind_ok === undefined ? null : leaf.valgrind_ok ? 1 : 0,
        leaf.valgrind_details ?? null,
        Number.isFinite(leaf.duration_ms) ? leaf.duration_ms : null,
      );
    });
  });
  tx();
  const normalized = leaves.map((l) => ({ ...l, valgrind_ok: l.valgrind_ok === false ? 0 : l.valgrind_ok }));
  return { passed: normalized.filter(leafPassed).length, total: normalized.length };
}

export function getResults(submissionId) {
  return db()
    .prepare('SELECT * FROM test_results WHERE submission_id = ? ORDER BY position')
    .all(submissionId);
}
