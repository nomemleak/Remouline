// In-memory imitation of the API, used only in local mock mode (see mode.ts).
// Results come from REAL pipeline reports (fixtures/*.json, generated from
// examples/DemoMission). State lives in memory and resets when the dev server restarts.
import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import { ApiError } from '../api';
import type { Role } from './mode';
import correct from './fixtures/correct.json';
import broken from './fixtures/broken.json';
import leak from './fixtures/leak.json';
import buildfail from './fixtures/buildfail.json';
import stub from './fixtures/stub.json';
import stubOther from './fixtures/stub-other.json';

type Leaf = Record<string, unknown> & {
  category_path: string; test_name: string; status: string; valgrind_ok: boolean | number | null;
  error_message?: string | null; raw_output?: string | null; expected_output?: string | null; actual_output?: string | null;
};
type RunReport = { results: Leaf[] };
type Sub = {
  id: number; kind: 'push' | 'validation'; student: string; assignment: string | null; repo_name: string | null;
  commit_sha: string | null; validation_role: 'stub' | 'stub_other' | null; status: string; passed: number | null;
  total: number | null; message: string | null; job_log: string | null; attempt: number; created_at: string;
  started_at: string | null; finished_at: string | null; duration_ms: number | null;
  report: RunReport | null; runningUntil?: number;
};
type SourceFile = { path: string; content: string };
type Assignment = {
  slug: string; title: string; status: 'draft' | 'published'; tests_version: number; validation_status: string;
  validation_report: Record<string, unknown> | null; created_at: string; published_at: string | null; validated_at: string | null;
  staging: SourceFile[]; headers: SourceFile[]; published: string[];
  compile_flags: string | null; flag_overrides: string | null; flags_source: 'bundle' | 'admin' | 'fallback';
  validationDoneAt?: number;
};
const DEFAULT_FLAGS = '-Wall -Wextra -Werror';
const BUNDLE_FLAGS = '-std=c99 -pedantic -Werror -Wall -Wextra -Wvla';
type Account = {
  login: string; email: string | null; role: Role; active: number; created_via: string; invited_by: string | null;
  created_at: string; last_login_at: string | null; terms_accepted_at: string | null;
};
type Invitation = {
  id: number; token: string; created_by: string; created_by_admin: number; note: string | null; created_at: string; expires_at: string;
  used_at: string | null; used_by: string | null; revoked_at: string | null; preset_login?: string | null; preset_email?: string | null;
  role: 'student' | 'maintainer';
};
type TestReport = {
  id: number; assignment: string; category_path: string; test_name: string; author: string; message: string;
  evidence: Record<string, unknown> | null; status: 'open' | 'resolved' | 'rejected'; admin_note: string | null;
  created_at: string; closed_at: string | null; votes: Map<string, number>;
};

const GIT = 'https://git.example.com';
const ATTESTATION = {
  version: 1,
  text: 'I confirm that I have the right to use the material these tests are derived from, and that this testsuite contains neither a solution nor a copy of that material (subject text, statements).',
};
const PAGES = {
  terms: `# Terms of use

Remouline is an independent, non-commercial service that automatically tests C code pushed by its users.

## Your responsibility

- You are solely responsible for the code you push and for the way you use the results.
- Before pushing code written for a course, check the rules of your school or institution.
- Results are for self-assessment only: never present them as an official grade.

(Mock mode: the real default text is served by the API, see server/src/legal.js.)`,
  privacy: `# Privacy notice

- Pushes, results and repositories: deleted after {{DATA_DAYS}} days without activity.
- Accounts: deleted after {{ACCOUNT_DAYS}} days without any login or push.

(Mock mode: the real default text is served by the API, see server/src/legal.js.)`,
  legal: `# Legal notice

Remouline is a private, non-commercial, invitation-only service.

- Contact: {{CONTACT}}`,
};
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

function readDemo(folder: 'tests' | 'headers'): SourceFile[] {
  const root = path.join(process.cwd(), '..', 'examples', 'DemoMission', folder);
  const out: SourceFile[] = [];
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else out.push({ path: path.relative(root, full).split(path.sep).join('/'), content: fs.readFileSync(full, 'utf8') });
    }
  };
  walk(root);
  return out;
}

function leafPassed(l: Leaf) {
  return l.status === 'pass' && l.valgrind_ok !== false && l.valgrind_ok !== 0;
}

function sub(partial: Partial<Sub> & { id: number; student: string; created_at: string }): Sub {
  const report = partial.report ?? null;
  const passed = report ? report.results.filter(leafPassed).length : null;
  const repo = `c-course-${partial.student.replace(/\W/g, '-')}`;
  return {
    kind: 'push', assignment: 'DemoMission', repo_name: repo,
    commit_sha: Math.random().toString(16).slice(2, 12) + 'abcdef0123456789abcdef0123'.slice(0, 30),
    validation_role: null, status: 'done', passed, total: report ? report.results.length : null, message: null,
    job_log: `[mock] cloning ${partial.student}/${repo}\n[mock] resolved assignment slug: DemoMission\n[mock] starting container job-${partial.id}-1\n[mock] pipeline stdout:\nreport written`,
    attempt: 1, started_at: partial.created_at, finished_at: partial.created_at, duration_ms: 14_000 + partial.id * 37,
    ...partial,
    report,
  } as Sub;
}

// A failed validation, derived from the real stub runs: count_chars tests made
// vacuous (they pass on both empty versions) and the shout program made unbuildable.
function failedStubReport(source: RunReport): RunReport {
  return {
    results: source.results.map((l) => {
      if (l.category_path.startsWith('Testsuite/Fundamentals/count_chars')) {
        return { ...l, status: 'pass', error_message: null, expected_output: null, actual_output: null };
      }
      if (l.category_path === 'Build/Programs' && l.test_name === 'shout') {
        return { ...l, status: 'fail', error_message: 'Link failed: a function required by the tests is missing or has the wrong name/signature.',
          raw_output: "$ link with Programs/shout/test_shout.c\n/usr/bin/ld: test_shout.o: in function `shout_capitalizes_words_impl':\ntest_shout.c:41: undefined reference to `capitalize_words'\ncollect2: error: ld returned 1 exit status" };
      }
      if (l.category_path.startsWith('Testsuite/Programs/shout')) {
        return { ...l, status: 'skipped', error_message: 'Not run: the build failed (see the Build section).' };
      }
      return l;
    }),
  };
}

function initialState() {
  const tests = readDemo('tests');
  const headers = readDemo('headers');
  const accounts: Account[] = [
    { login: 'operator', email: null, role: 'operator', active: 1, created_via: 'login', invited_by: null, created_at: ago(9000), last_login_at: ago(1), terms_accepted_at: ago(9000) },
    { login: 'm-demo42', email: null, role: 'maintainer', active: 1, created_via: 'admin', invited_by: null, created_at: ago(8500), last_login_at: ago(40), terms_accepted_at: ago(8500) },
    { login: 'mock.student', email: 'student@example.com', role: 'student', active: 1, created_via: 'admin', invited_by: null, created_at: ago(8000), last_login_at: ago(30), terms_accepted_at: ago(8000) },
    { login: 'mock.other', email: null, role: 'student', active: 1, created_via: 'invite', invited_by: 'mock.student', created_at: ago(4000), last_login_at: ago(200), terms_accepted_at: ago(4000) },
    { login: 'mock.banned', email: null, role: 'student', active: 0, created_via: 'invite', invited_by: 'mock.other', created_at: ago(3000), last_login_at: null, terms_accepted_at: ago(3000) },
  ];
  const submissions: Sub[] = [
    sub({ id: 101, student: 'mock.student', created_at: ago(300), report: correct as RunReport }),
    sub({ id: 102, student: 'mock.student', created_at: ago(240), report: buildfail as RunReport }),
    sub({ id: 103, student: 'mock.student', created_at: ago(200), status: 'infra_error', report: null,
      message: 'Docker failed to start the correction container (exit 125).' }),
    sub({ id: 104, student: 'mock.student', created_at: ago(120), report: leak as RunReport }),
    sub({ id: 105, student: 'mock.student', created_at: ago(15), report: broken as RunReport }),
    sub({ id: 106, student: 'mock.student', assignment: 'Unknown', created_at: ago(10), status: 'not_configured', report: null,
      message: 'Assignment "Unknown" is not configured on Remouline (no published testsuite for this folder name).' }),
    sub({ id: 201, student: 'mock.other', created_at: ago(60), report: correct as RunReport }),
    sub({ id: 301, student: '__reference__', kind: 'validation', validation_role: 'stub', created_at: ago(5000), report: stub as RunReport }),
    sub({ id: 303, student: '__reference__', kind: 'validation', validation_role: 'stub_other', created_at: ago(5000), report: stubOther as RunReport }),
    sub({ id: 302, student: '__reference__', kind: 'validation', validation_role: 'stub', assignment: 'SpaceMission', created_at: ago(40), report: failedStubReport(stub as RunReport) }),
    sub({ id: 304, student: '__reference__', kind: 'validation', validation_role: 'stub_other', assignment: 'SpaceMission', created_at: ago(40), report: failedStubReport(stubOther as RunReport) }),
  ];
  const demo: Assignment = {
    slug: 'DemoMission', title: 'Demo mission', status: 'published', tests_version: 1, validation_status: 'passed',
    validation_report: { stubSubmissionId: 301, otherSubmissionId: 303, startedAt: ago(5000), finishedAt: ago(4998), status: 'passed', blocking: [], warnings: [] },
    created_at: ago(6000), published_at: ago(4990), validated_at: ago(4998),
    staging: tests, headers, published: tests.map((t) => t.path),
    compile_flags: DEFAULT_FLAGS, flag_overrides: null, flags_source: 'fallback',
  };
  const draft: Assignment = {
    slug: 'SpaceMission', title: 'Space mission', status: 'draft', tests_version: 1, validation_status: 'failed',
    validation_report: {
      stubSubmissionId: 302, otherSubmissionId: 304, startedAt: ago(40), finishedAt: ago(39), status: 'failed', warnings: [],
      blocking: [
        'Cannot build Programs/shout against the headers: Link failed: a function required by the tests is missing or has the wrong name/signature.',
        'No test of Fundamentals/count_chars/count_chars fails on either empty implementation (0/NULL or non-zero): they check nothing.',
      ],
    },
    created_at: ago(50), published_at: null, validated_at: ago(39), staging: tests, headers, published: [],
    compile_flags: BUNDLE_FLAGS, flag_overrides: 'file_io: -pedantic -Werror -Wall -Wextra -Wvla', flags_source: 'bundle',
  };
  const invitations: Invitation[] = [
    { id: 1, token: 'mock-used-token-aaaaaaaaaaaaaaaa', created_by: 'mock.student', created_by_admin: 0, note: null, created_at: ago(4100), expires_at: ago(-100), used_at: ago(4000), used_by: 'mock.other', revoked_at: null, role: 'student' },
    { id: 2, token: 'mock-valid-token-bbbbbbbbbbbbbbbb', created_by: 'operator', created_by_admin: 1, note: 'for a friend', created_at: ago(20), expires_at: ago(-4000), used_at: null, used_by: null, revoked_at: null, role: 'student' },
  ];
  const reports: TestReport[] = [
    {
      id: 1, assignment: 'DemoMission', category_path: 'Testsuite/Programs/shout/shout', test_name: 'uppercases_argument',
      author: 'mock.other', status: 'open', admin_note: null, created_at: ago(50), closed_at: null,
      message: 'The subject says the program prints the text in uppercase but never mentions a trailing newline. My output is correct without "\\n".',
      evidence: { status: 'fail', error_message: 'Expected "HELLO\\n" but got "HELLO"', expected_output: '"HELLO\\n"', actual_output: '"HELLO"' },
      votes: new Map([['mock.other', 1], ['mock.banned', 1]]),
    },
    {
      id: 2, assignment: 'DemoMission', category_path: 'Testsuite/Fundamentals/add_numbers/add_numbers', test_name: 'negative_values',
      author: 'mock.student', status: 'rejected', admin_note: 'The subject asks for a plain sum: -4 + -6 is -10, the test is right.',
      created_at: ago(90), closed_at: ago(80),
      message: 'Negative numbers are not mentioned in the subject.', evidence: null,
      votes: new Map([['mock.student', 1], ['mock.other', -1]]),
    },
  ];
  const logs: { id: number; ts: string; service: string; level: string; message: string; context: string | null }[] = [
    { id: 4, ts: ago(15), service: 'worker', level: 'info', message: 'job 105-1-mock finished: done', context: '{"submission":105}' },
    { id: 3, ts: ago(200), service: 'worker', level: 'error', message: 'job 103-1-mock finished: infra_error', context: '{"submission":103,"message":"Docker failed to start the correction container (exit 125)."}' },
    { id: 2, ts: ago(300), service: 'webhook', level: 'warn', message: 'rejected webhook with an invalid signature', context: null },
    { id: 1, ts: ago(9000), service: 'api', level: 'info', message: 'API listening on :8080', context: null },
  ];
  const events: { id: number; event_type: string; student: string | null; assignment: string | null; detail: string; timestamp: string }[] = [
    { id: 1, event_type: 'admin_action', student: 'm-demo42', assignment: 'DemoMission', detail: 'published DemoMission', timestamp: ago(4990) },
  ];
  return {
    accounts, submissions, assignments: [demo, draft], invitations, reports, logs, events,
    accessMode: 'sharing' as 'closed' | 'sharing', maxInvites: 3, nextId: 400,
    service: { paused: false, message: '' }, contact: 'contact@example.com', termsVersion: 1,
    pages: { ...PAGES } as Record<'terms' | 'privacy' | 'legal', string>,
  };
}

type State = ReturnType<typeof initialState>;
// Bump when the shape of the mock state changes: a running dev server then resets it
// on the next request instead of serving stale data after hot reload.
const STATE_VERSION = 9;
const g = globalThis as unknown as { __remoulineMock?: State; __remoulineMockVersion?: number };
function state(): State {
  if (!g.__remoulineMock || g.__remoulineMockVersion !== STATE_VERSION) {
    g.__remoulineMock = initialState();
    g.__remoulineMockVersion = STATE_VERSION;
  }
  const s = g.__remoulineMock;
  // Simulated asynchronous work: "running" jobs and validations finish after a few seconds.
  const now = Date.now();
  for (const x of s.submissions) {
    if (x.runningUntil && x.runningUntil < now) {
      x.runningUntil = undefined;
      x.status = 'done';
      x.finished_at = new Date().toISOString();
      x.duration_ms = 4000;
    }
  }
  for (const a of s.assignments) {
    if (a.validationDoneAt && a.validationDoneAt < now) {
      a.validationDoneAt = undefined;
      a.validation_status = 'passed';
      a.validated_at = new Date().toISOString();
      a.validation_report = { stubSubmissionId: 301, otherSubmissionId: 303, finishedAt: a.validated_at, status: 'passed', blocking: [], warnings: [] };
    }
  }
  return s;
}

// Same rule as server/src/invitations.js: accepted + still-pending links count.
function sharesOf(s: State, login: string) {
  const now = new Date().toISOString();
  return s.invitations.filter((i) => i.created_by === login && !i.created_by_admin && !i.revoked_at && (i.used_at || i.expires_at > now)).length;
}

const fail = (status: number, message: string): never => {
  throw new ApiError(status, message);
};
const pushCommand = (login: string) => `git push "${GIT}/${login}/$(basename -s .git "$(git remote get-url origin)").git" HEAD:main`;
const token = () => 'mock-' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
const serviceState = (s: State) => ({ paused: s.service.paused, message: s.service.paused ? s.service.message || 'The service is paused. Pushes are not graded for now.' : null });
const fillPage = (s: State, text: string) => text
  .replace(/\{\{APP\}\}/g, 'Remouline').replace(/\{\{CONTACT\}\}/g, s.contact || 'the operator')
  .replace(/\{\{DATA_DAYS\}\}/g, '60').replace(/\{\{ACCOUNT_DAYS\}\}/g, '180').replace(/\{\{LOG_DAYS\}\}/g, '30').replace(/\{\{BACKUP_DAYS\}\}/g, '30');

const SUB_PUBLIC = (x: Sub) => {
  const { report: _r, runningUntil: _u, ...rest } = x;
  void _r; void _u;
  return rest;
};
const results = (x: Sub) =>
  x.status === 'done' && x.report ? x.report.results.map((l, i) => ({ id: x.id * 1000 + i, submission_id: x.id, position: i, ...l, valgrind_ok: l.valgrind_ok === null ? null : l.valgrind_ok ? 1 : 0 })) : [];

function previewTests(files: SourceFile[]) {
  const tests: { file: string; category_path: string; test_name: string }[] = [];
  const warnings: string[] = [];
  for (const f of files.filter((x) => x.path.endsWith('.c'))) {
    const parts = f.path.split('/');
    const exercise = parts.pop()!.replace(/\.c$/, '').replace(/^tests?_/, '').replace(/_tests?$/, '');
    if (parts[parts.length - 1] !== exercise) parts.push(exercise);
    const code = f.content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const found = [...code.matchAll(/\bTest\s*\(\s*([A-Za-z_]\w*)\s*,\s*([A-Za-z_]\w*)/g)];
    if (found.length === 0) warnings.push(`${f.path}: no Test(suite, name) macro found`);
    for (const m of found) tests.push({ file: f.path, category_path: ['Testsuite', ...parts, m[1]].join('/'), test_name: m[2] });
  }
  return { tests, warnings, count: tests.length };
}

function assignmentPayload(a: Assignment, role: Role = 'maintainer') {
  const { staging, headers, published, validationDoneAt: _v, ...assignment } = a;
  void _v;
  if (role !== 'maintainer') {
    const { slug, title, status, validation_status, created_at, published_at } = a;
    return { assignment: { slug, title, status, validation_status, created_at, published_at } };
  }
  return {
    assignment,
    stagingFiles: staging,
    headerFiles: headers,
    stubFiles: [{ path: '(mock mode)', content: 'The empty implementations are generated by the server (stubs.js).' }],
    stubOtherFiles: [],
    publishedFiles: published,
    defaultCompileFlags: DEFAULT_FLAGS,
    attestation: ATTESTATION,
    preview: previewTests(staging),
    stagingDiffersFromPublished: JSON.stringify(staging.map((f) => f.path)) !== JSON.stringify(published),
  };
}

function decode(files: { path: string; content: string; encoding?: string }[]) {
  return files.map((f) => ({ path: f.path, content: f.encoding === 'base64' ? Buffer.from(f.content, 'base64').toString('utf8') : f.content }));
}

function startValidation(s: State, a: Assignment) {
  if (!a.staging.length) {
    a.validation_status = 'none';
    a.validation_report = null;
    return false;
  }
  a.validation_status = 'running';
  a.validation_report = { stubSubmissionId: 301, otherSubmissionId: 303, startedAt: new Date().toISOString() };
  a.validationDoneAt = Date.now() + 4000;
  s.logs.unshift({ id: s.nextId++, ts: new Date().toISOString(), service: 'worker', level: 'info', message: `validation of ${a.slug} started`, context: null });
  return true;
}

function audit(s: State, who: string, detail: string, assignment: string | null = null) {
  s.events.unshift({ id: s.nextId++, event_type: 'admin_action', student: who, assignment, detail, timestamp: new Date().toISOString() });
}

// Anonymous for everyone (maintainers included): only the author knows a report is theirs.
function reportsView(s: State, slug: string, viewer: string | null) {
  return s.reports
    .filter((r) => r.assignment === slug)
    .sort((x, y) => (x.status === 'open' ? 0 : 1) - (y.status === 'open' ? 0 : 1) || y.id - x.id)
    .map((r) => {
      const { votes, author, ...rest } = r;
      const values = [...votes.values()];
      return { ...rest, agree: values.filter((v) => v === 1).length, disagree: values.filter((v) => v === -1).length, my_vote: viewer ? votes.get(viewer) ?? null : null, mine: author === viewer };
    });
}

function deleteAccount(s: State, login: string) {
  s.submissions = s.submissions.filter((x) => !(x.kind === 'push' && x.student === login));
  s.reports = s.reports.filter((r) => r.author !== login);
  for (const r of s.reports) r.votes.delete(login);
  s.invitations = s.invitations.filter((i) => i.created_by !== login && i.preset_login !== login && i.used_by !== login);
  for (const a of s.accounts) if (a.invited_by === login) a.invited_by = null;
  s.events = s.events.filter((e) => e.student !== login);
  s.accounts = s.accounts.filter((a) => a.login !== login);
  s.events.unshift({ id: s.nextId++, event_type: 'account', student: null, assignment: null, detail: 'an account was deleted', timestamp: new Date().toISOString() });
}

type Opts = { method?: string; body?: unknown };

export async function mockCall(scope: 'student' | 'admin' | 'public', login: string, rawPath: string, opts: Opts = {}): Promise<unknown> {
  const s = state();
  const url = new URL(rawPath, 'http://mock');
  const p = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const method = (opts.method ?? 'GET').toUpperCase();
  const body = (opts.body ?? {}) as Record<string, unknown>;
  const q = url.searchParams;
  await new Promise((r) => setTimeout(r, 120)); // a bit of latency, like a real network

  // ------------------------------------------------------------------ public
  if (scope === 'public') {
    if (p[0] === 'public' && p[1] === 'status') return { appName: 'Remouline', ...serviceState(s) };
    if (p[0] === 'public' && p[1] === 'pages') {
      const name = p[2] as keyof typeof PAGES;
      if (!(name in s.pages)) fail(404, 'not found');
      return { name, text: fillPage(s, s.pages[name]), termsVersion: s.termsVersion };
    }
    if (p[0] === 'reset') {
      if (method === 'GET') return { valid: p[1] === 'mock-reset-token-cccccccccccccccc', login: 'mock.student' };
      if (String(body.password ?? '').length < 8) fail(400, 'Choose a password of at least 8 characters.');
      return { login: 'mock.student' };
    }
    if (p[0] === 'invite') {
      const inv = s.invitations.find((i) => i.token === p[1]);
      const usable = inv && !inv.used_at && !inv.revoked_at && inv.expires_at > new Date().toISOString() && (inv.created_by_admin || s.accessMode === 'sharing');
      if (method === 'GET') {
        if (s.service.paused) return { valid: false, paused: true };
        return usable ? { valid: true, expiresAt: inv!.expires_at, login: inv!.preset_login ?? null, email: inv!.preset_email ?? null, role: inv!.role } : { valid: false };
      }
      if (s.service.paused) fail(503, 'The service is paused: accounts cannot be created for now.');
      if (!usable) fail(410, 'This invitation is invalid, expired or already used.');
      if (body.acceptTerms !== true) fail(400, 'You must accept the terms of use to create an account.');
      const newLogin = inv!.preset_login ?? String(body.login ?? '');
      const newEmail = inv!.preset_login ? inv!.preset_email ?? null : String(body.email ?? '') || null;
      if (String(body.password ?? '').length < 8) fail(400, 'Choose a password of at least 8 characters.');
      if (s.accounts.some((x) => x.login === newLogin)) fail(409, 'This login or email is already taken.');
      inv!.used_at = new Date().toISOString();
      inv!.used_by = newLogin;
      s.accounts.push({
        login: newLogin, email: newEmail, role: inv!.role, active: 1, created_via: inv!.created_by_admin ? 'admin' : 'invite',
        invited_by: inv!.created_by_admin ? null : inv!.created_by, created_at: inv!.used_at, last_login_at: null, terms_accepted_at: inv!.used_at,
      });
      return { login: newLogin };
    }
    return fail(404, 'not found');
  }

  const me = s.accounts.find((x) => x.login === login);
  if (!me) fail(401, 'unknown account');
  if (!me!.active) fail(403, 'account disabled');

  // ------------------------------------------------------------------ student
  if (scope === 'student') {
    const own = (x: Sub) => x.kind === 'push' && x.student === login;
    const published = s.assignments.filter((a) => a.status === 'published');
    const workedOn = (slug: string) => s.submissions.some((x) => own(x) && x.assignment === slug);
    if (p[0] === 'me') {
      return {
        login, role: me!.role, email: me!.email, createdAt: me!.created_at, termsAccepted: Boolean(me!.terms_accepted_at),
        termsVersion: s.termsVersion, accessMode: s.accessMode, service: serviceState(s), pushCommand: pushCommand(login),
      };
    }
    if (p[0] === 'terms') {
      me!.terms_accepted_at = new Date().toISOString();
      return { ok: true };
    }
    if (p[0] === 'password') {
      if (String(body.next ?? '').length < 8) fail(400, 'Choose a password of at least 8 characters.');
      if (!body.current) fail(400, 'The current password is wrong.');
      return { ok: true };
    }
    if (p[0] === 'export') {
      return {
        exportedAt: new Date().toISOString(), service: 'Remouline',
        note: 'Your code itself is in your Git repositories: clone them before deleting your account.',
        account: { login, email: me!.email, role: me!.role, created_at: me!.created_at },
        submissions: s.submissions.filter(own).map((x) => ({ ...SUB_PUBLIC(x), results: results(x) })),
        reports: s.reports.filter((r) => r.author === login).map(({ votes: _v, author: _a, ...r }) => (void _v, void _a, r)),
      };
    }
    if (p[0] === 'delete') {
      if (body.confirm !== login) fail(400, 'Type your login exactly to confirm.');
      if (!body.password) fail(400, 'Wrong password.');
      deleteAccount(s, login);
      return { ok: true };
    }
    if (p[0] === 'assignments' && !p[1]) {
      return {
        assignments: published.map((a) => {
          const mine = s.submissions.filter((x) => own(x) && x.assignment === a.slug).sort((x, y) => y.id - x.id);
          const l = mine[0];
          return { slug: a.slug, title: a.title, published_at: a.published_at, attempts: mine.length, latest: l ? { id: l.id, status: l.status, passed: l.passed, total: l.total, created_at: l.created_at } : null };
        }),
        unrouted: s.submissions.filter((x) => own(x) && !published.some((a) => a.slug === x.assignment)).map(SUB_PUBLIC),
      };
    }
    if (p[0] === 'assignments') {
      const a = published.find((x) => x.slug === p[1]) ?? fail(404, 'not found');
      if (p[2] === 'reports') {
        if (method === 'GET') return { canParticipate: workedOn(a.slug), reports: reportsView(s, a.slug, login) };
        // POST: create a report from one of the student's own results.
        const message = String(body.message ?? '').trim();
        if (message.length < 10) fail(400, 'Explain in a few words why the test looks wrong (10 characters minimum).');
        const resultId = Number(body.resultId);
        const owner = s.submissions.find((x) => own(x) && x.assignment === a.slug && x.id === Math.floor(resultId / 1000));
        const leaf = owner ? results(owner).find((l) => l.id === resultId) : undefined;
        if (!leaf) fail(404, 'Test result not found.');
        if (!leaf!.category_path.startsWith('Testsuite')) fail(400, 'Only Criterion tests can be reported.');
        const report: TestReport = {
          id: s.nextId++, assignment: a.slug, category_path: leaf!.category_path, test_name: leaf!.test_name, author: login,
          message, status: 'open', admin_note: null, created_at: new Date().toISOString(), closed_at: null,
          evidence: { status: leaf!.status, error_message: leaf!.error_message ?? null, expected_output: leaf!.expected_output ?? null, actual_output: leaf!.actual_output ?? null },
          votes: new Map([[login, 1]]),
        };
        s.reports.push(report);
        return { id: report.id };
      }
      const list = s.submissions.filter((x) => own(x) && x.assignment === a.slug).sort((x, y) => y.id - x.id).map(SUB_PUBLIC);
      return { assignment: { slug: a.slug, title: a.title, published_at: a.published_at }, submissions: list, pushCommand: pushCommand(login) };
    }
    if (p[0] === 'reports' && p[2] === 'vote') {
      const r = s.reports.find((x) => x.id === Number(p[1]));
      if (!r || !workedOn(r.assignment)) fail(404, 'Report not found.');
      if (r!.status !== 'open') fail(409, 'This report is closed.');
      const v = Number(body.vote);
      if (v === 0) r!.votes.delete(login);
      else r!.votes.set(login, v > 0 ? 1 : -1);
      return { ok: true };
    }
    if (p[0] === 'submissions') {
      // Same isolation rule as the real API: only the caller's own pushes.
      const x = s.submissions.find((y) => y.id === Number(p[1]) && own(y)) ?? fail(404, 'not found');
      return { submission: SUB_PUBLIC(x), results: results(x) };
    }
    if (p[0] === 'invitations') {
      const used = sharesOf(s, login);
      if (method === 'GET') {
        return {
          accessMode: s.accessMode, quota: { used, limit: s.maxInvites, remaining: Math.max(s.maxInvites - used, 0) },
          invitations: s.invitations.filter((i) => i.created_by === login).map(({ token: _t, preset_login: _l, preset_email: _e, ...i }) => (void _t, void _l, void _e, i)),
        };
      }
      if (method === 'POST') {
        if (s.accessMode !== 'sharing') fail(403, 'Invitations are disabled.');
        if (used >= s.maxInvites) fail(429, `You have reached your sharing limit (${used} / ${s.maxInvites}).`);
        const inv: Invitation = { id: s.nextId++, token: token(), created_by: login, created_by_admin: 0, note: null, created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 72 * 3600e3).toISOString(), used_at: null, used_by: null, revoked_at: null, role: 'student' };
        s.invitations.unshift(inv);
        return { id: inv.id, token: inv.token, expiresAt: inv.expires_at };
      }
      if (method === 'DELETE') {
        const inv = s.invitations.find((i) => i.id === Number(p[1]) && i.created_by === login);
        if (inv && !inv.used_at) inv.revoked_at = new Date().toISOString();
        return { ok: Boolean(inv) };
      }
    }
    return fail(404, 'not found');
  }

  // ------------------------------------------------------------------ admin
  const role = me!.role;
  if (role === 'student') fail(403, 'forbidden');
  const only = (r: Role) => {
    if (role !== r) fail(403, r === 'operator' ? 'Only an operator can do this.' : 'Only a maintainer can do this: testsuites are managed by maintainer accounts.');
  };
  const findA = (slug: string) => s.assignments.find((a) => a.slug === slug) ?? fail(404, 'assignment not found');

  if (p[0] === 'overview') {
    const pushes = s.submissions.filter((x) => x.kind === 'push');
    const assignments = s.assignments.map((a) => {
      const mine = pushes.filter((x) => x.assignment === a.slug);
      return { slug: a.slug, title: a.title, status: a.status, validation_status: a.validation_status, published_at: a.published_at, created_at: a.created_at,
        submissions: mine.length, students: new Set(mine.map((x) => x.student)).size, last_push: mine.map((x) => x.created_at).sort().pop() ?? null,
        open_reports: s.reports.filter((r) => r.assignment === a.slug && r.status === 'open').length };
    });
    if (role !== 'operator') return { role, assignments, service: serviceState(s) };
    return {
      role, assignments, service: serviceState(s),
      unrouted: pushes.filter((x) => x.status === 'not_configured').map(SUB_PUBLIC),
      infraErrors: s.submissions.filter((x) => x.kind === 'push' && ['infra_error', 'timeout'].includes(x.status)).map(SUB_PUBLIC),
      queue: [{ status: 'running', n: s.submissions.filter((x) => x.status === 'running').length }],
      accessMode: s.accessMode,
    };
  }

  if (p[0] === 'assignments') {
    if (!p[1] && method === 'POST') {
      only('maintainer');
      const slug = String(body.slug ?? '');
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(slug)) fail(400, 'The slug must match the assignment folder exactly (letters, digits, ".", "_", "-").');
      if (s.assignments.some((a) => a.slug === slug)) fail(409, 'This assignment already exists.');
      const a: Assignment = {
        slug, title: String(body.title || slug), status: 'draft', tests_version: 0, validation_status: 'none', validation_report: null,
        created_at: new Date().toISOString(), published_at: null, validated_at: null, staging: [], headers: [], published: [],
        compile_flags: DEFAULT_FLAGS, flag_overrides: null, flags_source: 'fallback',
      };
      s.assignments.unshift(a);
      audit(s, login, `created assignment ${slug}`, slug);
      return assignmentPayload(a);
    }
    const a = findA(p[1]);
    if (!p[2]) {
      if (method === 'PATCH') {
        only('maintainer');
        if (typeof body.title === 'string') a.title = body.title;
        if (typeof body.compile_flags === 'string') {
          if (!body.compile_flags.trim()) fail(400, 'The default compilation flags cannot be empty.');
          a.compile_flags = body.compile_flags.trim();
          a.flag_overrides = typeof body.flag_overrides === 'string' && body.flag_overrides.trim() ? body.flag_overrides.trim() : null;
          a.flags_source = 'admin';
          audit(s, login, `compilation flags of ${a.slug}: ${a.compile_flags}`, a.slug);
          startValidation(s, a);
        }
      }
      return assignmentPayload(a, role);
    }
    if (p[2] === 'bundle' && method === 'PUT') {
      only('maintainer');
      if (body.attest !== true) fail(400, 'Confirm that you have the right to use the material these tests are derived from.');
      type In = { path: string; content: string; encoding?: string }[];
      const merge = (current: SourceFile[], incoming: SourceFile[]) => {
        const map = new Map(current.map((f) => [f.path, f]));
        for (const f of incoming) map.set(f.path, f);
        return [...map.values()];
      };
      const groups = { staging: decode((body.tests ?? []) as In), headers: decode((body.headers ?? []) as In) };
      if (groups.staging.length + groups.headers.length === 0 && !body.flags) fail(400, 'No files received.');
      if (typeof body.flags === 'string' && body.flags.trim()) {
        const lines = body.flags.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        const def = lines.find((l) => l.startsWith('default:'));
        if (def) {
          a.compile_flags = def.slice('default:'.length).trim();
          a.flags_source = 'bundle';
        }
        a.flag_overrides = lines.filter((l) => !l.startsWith('default:')).join('\n') || null;
      }
      for (const key of ['staging', 'headers'] as const) {
        if (groups[key].length === 0) continue;
        a[key] = body.mode === 'replace' ? groups[key] : merge(a[key], groups[key]);
      }
      audit(s, login, `imported ${groups.staging.length} test file(s) and ${groups.headers.length} header(s) for ${a.slug} (${body.mode})`, a.slug);
      startValidation(s, a);
      return assignmentPayload(a);
    }
    if (p[2] === 'validate') {
      only('maintainer');
      if (!startValidation(s, a)) fail(400, 'Import the tests first.');
      return assignmentPayload(a);
    }
    if (p[2] === 'publish') {
      only('maintainer');
      const force = body.force === true && a.validation_status === 'failed';
      if (a.validation_status !== 'passed' && !force) fail(409, 'Publishing is blocked until the validation passes.');
      a.status = 'published';
      a.published = a.staging.map((f) => f.path);
      a.published_at = a.published_at ?? new Date().toISOString();
      audit(s, login, `published ${a.slug}`, a.slug);
      return assignmentPayload(a);
    }
    if (p[2] === 'unpublish') {
      a.status = 'draft';
      audit(s, login, `unpublished ${a.slug}`, a.slug);
      return assignmentPayload(a, role);
    }
    if (p[2] === 'delete') {
      if (body.confirm !== a.slug) fail(400, 'Type the exact assignment slug to confirm the deletion.');
      const before = s.submissions.length;
      s.submissions = s.submissions.filter((x) => x.assignment !== a.slug);
      const reportsBefore = s.reports.length;
      s.reports = s.reports.filter((r) => r.assignment !== a.slug);
      s.assignments = s.assignments.filter((x) => x.slug !== a.slug);
      audit(s, login, `deleted assignment ${a.slug}`);
      return { ok: true, subs: before - s.submissions.length, reports: reportsBefore - s.reports.length };
    }
    if (p[2] === 'reports') {
      only('maintainer');
      return { reports: reportsView(s, a.slug, null) };
    }
    if (p[2] === 'export') {
      only('maintainer');
      const files = { preview: previewTests(a.staging).tests, files: { tests: a.staging, headers: a.headers } };
      const strip = (l: Record<string, unknown>) => ({ category_path: l.category_path, test_name: l.test_name, status: l.status, error_message: l.error_message ?? null, raw_output: l.raw_output ?? null, valgrind_ok: l.valgrind_ok });
      if (p[3] === 'reports') {
        return { format: 'remouline-reports', version: 1, assignment: a.slug, exportedAt: new Date().toISOString(),
          reports: reportsView(s, a.slug, null).map(({ my_vote: _v, mine: _m, ...r }) => (void _v, void _m, r)), ...files };
      }
      const report = a.validation_report as { stubSubmissionId?: number; otherSubmissionId?: number; blocking?: string[]; warnings?: string[] } | null;
      if (!report?.stubSubmissionId) fail(404, 'No validation to export yet.');
      const run = (id?: number) => { const x = s.submissions.find((y) => y.id === id); return x ? results(x).map(strip) : []; };
      return {
        format: 'remouline-validation-report', version: 1, assignment: a.slug, exportedAt: new Date().toISOString(),
        validation: { status: a.validation_status, blocking: report!.blocking ?? [], warnings: report!.warnings ?? [], voidFunctions: [] },
        results: { zero: run(report!.stubSubmissionId), other: run(report!.otherSubmissionId) }, ...files,
      };
    }
    if (p[2] === 'feed') {
      only('operator');
      let list = s.submissions.filter((x) => x.kind === 'push' && x.assignment === a.slug);
      const students = [...new Set(list.map((x) => x.student))].sort();
      if (q.get('student')) list = list.filter((x) => x.student === q.get('student'));
      if (q.get('status')) list = list.filter((x) => x.status === q.get('status'));
      const term = q.get('q');
      if (term) list = list.filter((x) => [x.student, x.repo_name, x.commit_sha, x.message].some((v) => v?.includes(term)));
      return { submissions: list.sort((x, y) => y.id - x.id).map(SUB_PUBLIC), students, events: s.events.filter((e) => e.assignment === a.slug) };
    }
  }

  if (p[0] === 'reports' && p[2] === 'status') {
    only('maintainer');
    const r = s.reports.find((x) => x.id === Number(p[1])) ?? fail(404, 'Report not found.');
    const status = String(body.status);
    if (!['open', 'resolved', 'rejected'].includes(status)) fail(400, 'Invalid status.');
    r.status = status as TestReport['status'];
    r.admin_note = (body.note as string) || null;
    r.closed_at = status === 'open' ? null : new Date().toISOString();
    audit(s, login, `report #${r.id} marked ${status}`, r.assignment);
    return { ok: true };
  }

  if (p[0] === 'submissions') {
    // Maintainers only reach validation runs, operators only pushes.
    const x = s.submissions.find((y) => y.id === Number(p[1]) && (role === 'maintainer' ? y.kind === 'validation' : y.kind === 'push')) ?? fail(404, 'not found');
    if (p[2] === 'rerun') {
      if (['queued', 'running'].includes(x.status)) fail(409, 'Already queued or running.');
      x.attempt += 1;
      x.status = 'running';
      x.started_at = new Date().toISOString();
      x.runningUntil = Date.now() + 5000;
      if (!x.report && x.assignment === 'DemoMission') {
        x.report = correct as RunReport;
        x.message = null;
      }
      if (x.report) {
        x.passed = x.report.results.filter(leafPassed).length;
        x.total = x.report.results.length;
      }
      audit(s, login, `re-ran submission #${x.id}`, x.assignment);
      return { ok: true };
    }
    return { submission: SUB_PUBLIC(x), results: results(x) };
  }

  // Everything below: operators only.
  only('operator');

  if (p[0] === 'students') {
    const students = s.accounts.filter((a) => a.role === 'student');
    const withStats = (st: Account) => {
      const mine = s.submissions.filter((x) => x.kind === 'push' && x.student === st.login);
      return { ...st, submissions: mine.length, last_push: mine.map((x) => x.created_at).sort().pop() ?? null };
    };
    if (!p[1] && method === 'GET') return { students: students.map(withStats), accessMode: s.accessMode };
    if (!p[1] && method === 'POST') {
      const [one] = personalInvitations(s, login, [{ login: String(body.login ?? '').trim(), email: String(body.email ?? '').trim() }], Number(body.ttlDays), String(body.note ?? ''));
      if (one.error) fail(400, one.error);
      return { invitations: [one] };
    }
    if (p[1] === 'bulk') {
      const rows = String(body.csv ?? '').split(/\r?\n/).map((l) => l.split(/[,;\t]/).map((c) => c.trim())).filter(([l]) => l && l.toLowerCase() !== 'login');
      return { invitations: personalInvitations(s, login, rows.map(([l, e]) => ({ login: l, email: e ?? '' })), Number(body.ttlDays)) };
    }
    const st = s.accounts.find((x) => x.login === p[1] && x.role !== 'operator') ?? fail(404, 'not found');
    if (p[2] === 'active') {
      st.active = body.active ? 1 : 0;
      if (!st.active) for (const i of s.invitations) if (i.created_by === st.login && !i.used_at) i.revoked_at = new Date().toISOString();
      audit(s, login, `${st.active ? 'enabled' : 'disabled'} account ${st.login}`);
      return { ok: true };
    }
    if (p[2] === 'reset-link') {
      audit(s, login, `password reset link for ${st.login}`);
      return { token: 'mock-reset-token-cccccccccccccccc', expiresAt: new Date(Date.now() + 72 * 3600e3).toISOString() };
    }
    if (p[2] === 'delete') {
      if (body.confirm !== st.login) fail(400, 'Type the exact login to confirm the deletion.');
      deleteAccount(s, st.login);
      return { ok: true };
    }
    if (st.role !== 'student') fail(404, 'not found');
    const mine = s.submissions.filter((x) => x.kind === 'push' && x.student === st.login);
    const byA = new Map<string | null, Sub[]>();
    for (const x of mine) byA.set(x.assignment, [...(byA.get(x.assignment) ?? []), x]);
    return {
      student: st,
      gitea: { prohibit_login: !st.active, created: st.created_at },
      repos: [...new Set(mine.map((x) => x.repo_name))].map((name) => ({ name, private: true, updated_at: ago(15) })),
      assignments: [...byA.entries()].map(([assignment, list]) => ({ assignment, attempts: list.length, last_push: list.map((x) => x.created_at).sort().pop() })),
      invitees: s.accounts.filter((x) => x.invited_by === st.login).map((x) => ({ login: x.login, active: x.active, created_at: x.created_at })),
      pushCommand: pushCommand(st.login),
    };
  }

  if (p[0] === 'maintainers') {
    if (method === 'POST') {
      const pseudo = `m-${Math.random().toString(36).slice(2, 8)}`;
      const inv: Invitation = {
        id: s.nextId++, token: token(), created_by: login, created_by_admin: 1, note: 'maintainer', created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 7 * 86400e3).toISOString(), used_at: null, used_by: null, revoked_at: null, preset_login: pseudo, role: 'maintainer',
      };
      s.invitations.unshift(inv);
      audit(s, login, `maintainer invitation for ${pseudo}`);
      return { login: pseudo, token: inv.token, expiresAt: inv.expires_at };
    }
    return {
      maintainers: s.accounts.filter((a) => a.role === 'maintainer').map(({ login: l, active, created_at, last_login_at }) => ({ login: l, active, created_at, last_login_at })),
      invitations: s.invitations.filter((i) => i.role === 'maintainer').map(({ token: _t, preset_email: _e, ...i }) => (void _t, void _e, i)),
    };
  }

  if (p[0] === 'access') {
    if (!p[1]) {
      const students = s.accounts.filter((a) => a.role === 'student');
      return {
        accessMode: s.accessMode, modes: ['closed', 'sharing'], inviteTtlHours: 72, maxInvitesPerStudent: s.maxInvites,
        invitations: s.invitations.filter((i) => i.role === 'student').map(({ token: _t, ...i }) => (void _t, i)),
        tree: students.map(({ login: l, invited_by, active, created_via, created_at }) => ({ login: l, invited_by, active, created_via, created_at, shares: sharesOf(s, l) })),
      };
    }
    if (p[1] === 'max-invites') {
      const n = Number(body.value);
      if (!Number.isInteger(n) || n < 0 || n > 100) fail(400, 'The limit must be an integer between 0 and 100.');
      s.maxInvites = n;
      audit(s, login, `sharing limit set to ${n} per student`);
      return { maxInvitesPerStudent: n };
    }
    if (p[1] === 'mode') {
      s.accessMode = body.mode === 'sharing' ? 'sharing' : 'closed';
      if (s.accessMode === 'closed') for (const i of s.invitations) if (!i.created_by_admin && !i.used_at && !i.revoked_at) i.revoked_at = new Date().toISOString();
      audit(s, login, `access mode set to "${s.accessMode}"`);
      return { accessMode: s.accessMode };
    }
    if (p[1] === 'invitations' && method === 'DELETE') {
      const inv = s.invitations.find((i) => i.id === Number(p[2]));
      if (inv && !inv.used_at) inv.revoked_at = new Date().toISOString();
      return { ok: Boolean(inv) };
    }
  }

  if (p[0] === 'settings') {
    if (!p[1]) {
      return {
        service: serviceState(s), contact: s.contact, termsVersion: s.termsVersion, pages: s.pages,
        retention: { dataDays: 60, accountDays: 180, logDays: 30, backupDays: 30 },
      };
    }
    if (p[1] === 'service') {
      s.service = { paused: body.paused === true, message: String(body.message ?? '') };
      audit(s, login, s.service.paused ? 'service PAUSED' : 'service resumed');
      return { service: serviceState(s) };
    }
    if (p[1] === 'contact') {
      s.contact = String(body.contact ?? '').trim();
      return { contact: s.contact };
    }
    if (p[1] === 'pages') {
      const name = p[2] as keyof typeof PAGES;
      if (!(name in PAGES)) fail(404, 'Unknown page.');
      const next = body.reset === true ? PAGES[name] : String(body.text ?? '').trim();
      if (next.length < 20) fail(400, 'The page is too short.');
      if (next !== s.pages[name]) {
        s.pages[name] = next;
        if (name === 'terms') {
          s.termsVersion += 1;
          for (const a of s.accounts) a.terms_accepted_at = null;
        }
      }
      return { text: s.pages[name], termsVersion: s.termsVersion };
    }
  }

  if (p[0] === 'logs') {
    let logs = s.logs;
    if (q.get('service')) logs = logs.filter((l) => l.service === q.get('service'));
    if (q.get('level')) logs = logs.filter((l) => l.level === q.get('level'));
    if (q.get('q')) logs = logs.filter((l) => l.message.includes(q.get('q')!));
    return { logs };
  }
  if (p[0] === 'activity') return { events: s.events };
  return fail(404, 'not found');
}

// Same behavior as the real API: personal link (login fixed, email optional) or, with neither, an open link.
function personalInvitations(s: State, admin: string, rows: { login: string; email: string }[], ttlDays: number, note = '') {
  const days = Math.min(Math.max(ttlDays || 14, 1), 60);
  return rows.map(({ login, email }) => {
    const expiresAt = new Date(Date.now() + days * 86400e3).toISOString();
    if (!login && !email) {
      const inv: Invitation = {
        id: s.nextId++, token: token(), created_by: admin, created_by_admin: 1, note: note || null, created_at: new Date().toISOString(),
        expires_at: expiresAt, used_at: null, used_by: null, revoked_at: null, role: 'student',
      };
      s.invitations.unshift(inv);
      return { login: null, email: null, open: true, token: inv.token, expiresAt };
    }
    if (!login) return { login, email, error: 'an email needs a login (personal link); leave both empty for an open link' };
    if (s.accounts.some((x) => x.login === login)) return { login, email, error: 'already has an account' };
    for (const i of s.invitations) if (i.preset_login === login && !i.used_at) i.revoked_at = new Date().toISOString();
    const inv: Invitation = {
      id: s.nextId++, token: token(), created_by: admin, created_by_admin: 1, note: `personal link for ${login}`, created_at: new Date().toISOString(),
      expires_at: expiresAt, used_at: null, used_by: null, revoked_at: null, preset_login: login, preset_email: email || null, role: 'student',
    };
    s.invitations.unshift(inv);
    return { login, email: email || null, token: inv.token, expiresAt };
  });
}
