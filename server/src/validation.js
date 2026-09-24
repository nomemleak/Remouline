// Testsuite validation WITHOUT any reference solution. The tests are graded, through
// the standard correction pipeline, against two EMPTY implementations generated from
// the headers (see stubs.js): one returning 0 / NULL, one returning non-zero values.
// It proves that:
//   - every test file compiles and links against the declared prototypes;
//   - every function (Criterion suite) has at least one test that fails on one of the
//     two empty versions. A test expecting NULL/0 (error case) passes on the first
//     but fails on the second: only tests passing on BOTH check nothing.
// Whether expected values are right is left to the students' votes on reports.
import { db, now } from './db.js';
import { enqueueSubmission } from './queue.js';
import { getResults, leafPassed } from './results.js';
import { dirs, hasFiles } from './assignments.js';
import { generateStubSubmission } from './stubs.js';

export const REFERENCE_STUDENT = '__reference__';
export const STUB_ROLES = { stub: 'zero', stub_other: 'other' };

export function canValidate(slug) {
  return hasFiles(dirs(slug).staging);
}

export async function startValidation(slug) {
  const d = dirs(slug);
  const { notes, voidFunctions } = generateStubSubmission(d.staging, d.headers, d.stub, 'zero');
  generateStubSubmission(d.staging, d.headers, d.stubOther, 'other');
  const insert = db().prepare(
    `INSERT INTO submissions (kind, student, assignment, validation_role, status) VALUES ('validation', ?, ?, ?, 'queued')`,
  );
  const stubId = Number(insert.run(REFERENCE_STUDENT, slug, 'stub').lastInsertRowid);
  const otherId = Number(insert.run(REFERENCE_STUDENT, slug, 'stub_other').lastInsertRowid);
  const report = { stubSubmissionId: stubId, otherSubmissionId: otherId, startedAt: now(), stubNotes: notes, voidFunctions };
  db()
    .prepare("UPDATE assignments SET validation_status = 'running', validation_report = ? WHERE slug = ?")
    .run(JSON.stringify(report), slug);
  await enqueueSubmission({ type: 'validation', submissionId: stubId, slug, role: 'stub' });
  await enqueueSubmission({ type: 'validation', submissionId: otherId, slug, role: 'stub_other' });
  return report;
}

// "Fundamentals/create_village" for Build leaves and Testsuite leaves alike.
export function exerciseKey(leaf) {
  const parts = leaf.category_path.split('/');
  if (parts[0] === 'Build') return [...parts.slice(1), leaf.test_name].join('/');
  return parts.slice(1, -1).join('/');
}

/**
 * Pure verdict from the two runs (exported for unit tests). `voidFunctions`: suites
 * named after a void function (free_*, destroy_*...) cannot fail on empty code (doing
 * nothing is only visible as a leak, checked by valgrind on student runs): warning only.
 */
export function judge(zeroResults, otherResults, { voidFunctions = [] } = {}) {
  const voids = new Set(voidFunctions);
  const blocking = [];
  const warnings = [];
  const tests = zeroResults.filter((l) => l.category_path.startsWith('Testsuite'));
  if (tests.length === 0) blocking.push('No Criterion test was found.');

  const buildFailed = new Set();
  for (const leaf of zeroResults.filter((l) => l.category_path.startsWith('Build') && l.status !== 'pass')) {
    buildFailed.add(exerciseKey(leaf));
    blocking.push(`Cannot build ${exerciseKey(leaf)} against the headers: ${leaf.error_message || 'see output'}`);
  }
  const brokenFiles = new Set();
  for (const leaf of tests.filter((l) => l.status === 'error')) {
    if (brokenFiles.has(exerciseKey(leaf))) continue;
    brokenFiles.add(exerciseKey(leaf));
    blocking.push(`Test file does not compile: ${exerciseKey(leaf)}`);
  }

  const other = new Map(otherResults.map((l) => [`${l.category_path}\u0000${l.test_name}`, l]));
  const passesBoth = (leaf) => {
    const twin = other.get(`${leaf.category_path}\u0000${leaf.test_name}`);
    return leafPassed(leaf) && Boolean(twin) && leafPassed(twin);
  };
  // One group per Criterion suite, i.e. usually one per function of the exercise file.
  const suites = new Map();
  for (const leaf of tests) {
    const key = exerciseKey(leaf);
    if (buildFailed.has(key) || brokenFiles.has(key)) continue;
    suites.set(leaf.category_path, [...(suites.get(leaf.category_path) ?? []), leaf]);
  }
  for (const [suite, leaves] of suites) {
    const vacuous = leaves.filter(passesBoth);
    const suiteName = suite.slice(suite.lastIndexOf('/') + 1);
    if (vacuous.length === leaves.length && voids.has(suiteName)) {
      warnings.push(`${suite.replace(/^Testsuite\//, '')}: void function, cannot fail on empty code (leaks are checked by valgrind on student runs).`);
    } else if (vacuous.length === leaves.length) {
      blocking.push(`No test of ${suite.replace(/^Testsuite\//, '')} fails on either empty implementation (0/NULL or non-zero): they check nothing.`);
    } else {
      for (const leaf of vacuous) warnings.push(`Passes on both empty implementations: ${leaf.category_path}/${leaf.test_name}`);
    }
  }
  return { blocking, warnings };
}

/** Called by the worker after each validation run; decides once both are graded. */
export function evaluateValidation(slug) {
  const assignment = db().prepare('SELECT * FROM assignments WHERE slug = ?').get(slug);
  if (!assignment?.validation_report) return;
  const report = JSON.parse(assignment.validation_report);
  const load = (id) => (id ? db().prepare('SELECT * FROM submissions WHERE id = ?').get(id) : null);
  const zero = load(report.stubSubmissionId);
  const other = load(report.otherSubmissionId);
  if (!zero || !other || [zero, other].some((s) => ['queued', 'running'].includes(s.status))) return;

  let verdict;
  const failedRun = [zero, other].find((s) => s.status !== 'done');
  if (failedRun) {
    verdict = { blocking: [`A validation run could not be graded (${failedRun.status}): ${failedRun.message || 'see the job log'}`], warnings: [] };
  } else {
    verdict = judge(getResults(zero.id), getResults(other.id), { voidFunctions: report.voidFunctions });
  }
  const status = verdict.blocking.length === 0 ? 'passed' : 'failed';
  const final = { ...report, finishedAt: now(), status, ...verdict };
  db()
    .prepare('UPDATE assignments SET validation_status = ?, validation_report = ?, validated_at = ? WHERE slug = ?')
    .run(status, JSON.stringify(final), now(), slug);
}
