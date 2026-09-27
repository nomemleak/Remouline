// End-to-end tests of the real API process (accounts, roles, terms, pause, deletion)
// against a fake Gitea. No Redis needed: nothing here enqueues a correction.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startFakeGitea, freePort } from './helpers/fake-gitea.js';

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let gitea;
let api;
let base;
let work;

before(async () => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'remouline-api-'));
  gitea = await startFakeGitea();
  gitea.users.set('operator', { password: 'operator-pass', prohibit: false });
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  api = spawn(process.execPath, ['src/api/server.js'], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      DB_PATH: path.join(work, 'remouline.db'), ASSIGNMENTS_DIR: path.join(work, 'assignments'), JOBS_DIR: path.join(work, 'jobs'),
      GITEA_INTERNAL_URL: gitea.url, GITEA_PUBLIC_URL: 'https://git.example.com', GITEA_ADMIN_TOKEN: 'admin-token',
      API_TOKEN: 'user-token', ADMIN_API_TOKEN: 'staff-token', OPERATOR_LOGINS: 'operator', API_PORT: String(port),
      REDIS_URL: 'redis://127.0.0.1:1',
    },
  });
  let output = '';
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`API did not start:\n${output}`)), 15000);
    const onData = (chunk) => {
      output += chunk;
      if (output.includes('API listening')) {
        clearTimeout(timer);
        resolve();
      }
    };
    api.stdout.on('data', onData);
    api.stderr.on('data', onData);
  });
});

after(async () => {
  // Wait for the API to exit before deleting its database (Windows keeps the file locked).
  if (api && api.exitCode === null) await new Promise((resolve) => api.once('exit', resolve).kill());
  gitea?.close();
  fs.rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

async function call(method, route, { body, token = 'user-token', student, admin } = {}) {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  if (student) headers['X-Remouline-Student'] = student;
  if (admin) headers['X-Remouline-Admin'] = admin;
  const res = await fetch(`${base}${route}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => null) };
}
const staff = (login, method, route, body) => call(method, `/v1/admin${route}`, { token: 'staff-token', admin: login, body });
const login = (name, password, clientIp = '10.0.0.1') => call('POST', '/v1/auth/login', { body: { login: name, password, clientIp } });

async function invite(login_, email) {
  const res = await staff('operator', 'POST', '/students', { login: login_, email });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  return res.data.invitations[0].token;
}

test('login is checked against Gitea and returns the canonical login and role', async () => {
  assert.equal((await login('operator', 'wrong')).status, 401);
  assert.deepEqual((await login('OPERATOR', 'operator-pass')).data, { login: 'operator', role: 'operator' });
});

test('failed logins are rate-limited per login', async () => {
  for (let i = 0; i < 8; i += 1) await login('victim', 'x', `10.1.0.${i}`);
  assert.equal((await login('victim', 'x', '10.1.0.99')).status, 429);
});

test('the terms must be accepted, once per version', async () => {
  assert.equal((await call('GET', '/v1/student/me', { student: 'operator' })).data.termsAccepted, false);
  await call('POST', '/v1/student/terms/accept', { student: 'operator' });
  assert.equal((await call('GET', '/v1/student/me', { student: 'operator' })).data.termsAccepted, true);
});

test('personal invitation: email optional, terms mandatory, placeholder email in Gitea', async () => {
  const token = await invite('jane.doe');
  assert.equal((await call('POST', `/v1/invite/${token}/redeem`, { body: { password: 'secret-pass-1' } })).status, 400);
  const res = await call('POST', `/v1/invite/${token}/redeem`, { body: { password: 'secret-pass-1', acceptTerms: true } });
  assert.deepEqual(res.data, { login: 'jane.doe' });
  assert.equal(gitea.users.get('jane.doe').email, 'jane.doe@noreply.localhost');
  assert.equal((await call('POST', `/v1/invite/${token}/redeem`, { body: { password: 'secret-pass-1', acceptTerms: true } })).status, 410);
});

test('maintainer invitations force a generated pseudonymous login', async () => {
  const inv = (await staff('operator', 'POST', '/maintainers', {})).data;
  assert.match(inv.login, /^m-[a-z2-9]{6}$/);
  assert.equal((await call('GET', `/v1/invite/${inv.token}`)).data.role, 'maintainer');
  const res = await call('POST', `/v1/invite/${inv.token}/redeem`, { body: { login: 'chosen-name', password: 'maint-pass-1', acceptTerms: true } });
  assert.equal(res.data.login, inv.login);
});

test('roles: students, maintainers and operators only reach their own routes', async () => {
  const maintainer = (await staff('operator', 'GET', '/maintainers')).data.maintainers[0].login;
  assert.equal((await staff('jane.doe', 'GET', '/overview')).status, 403);
  assert.equal((await staff(maintainer, 'GET', '/students')).status, 403);
  assert.equal((await staff(maintainer, 'GET', '/logs')).status, 403);
  const overview = (await staff(maintainer, 'GET', '/overview')).data;
  assert.equal(overview.role, 'maintainer');
  assert.equal(overview.unrouted, undefined, 'maintainers never get student logins');
  assert.equal((await staff('operator', 'POST', '/assignments', { slug: 'SpaceMission' })).status, 403);
  assert.equal((await staff(maintainer, 'POST', '/assignments', { slug: 'SpaceMission' })).status, 201);
  const noAttestation = await staff(maintainer, 'PUT', '/assignments/SpaceMission/bundle', { tests: [{ path: 'a/test_a.c', content: 'Test(a, b) {}' }] });
  assert.equal(noAttestation.status, 400);
  assert.match(noAttestation.data.error, /right to use/);
  assert.equal((await staff('operator', 'GET', '/assignments/SpaceMission')).data.stagingFiles, undefined, 'operators do not see testsuites');
});

test('password change and single-use reset link', async () => {
  const wrong = await call('POST', '/v1/student/password', { student: 'jane.doe', body: { current: 'nope', next: 'new-pass-123' } });
  assert.equal(wrong.status, 400);
  assert.equal((await call('POST', '/v1/student/password', { student: 'jane.doe', body: { current: 'secret-pass-1', next: 'new-pass-123' } })).status, 200);
  const { token } = (await staff('operator', 'POST', '/students/jane.doe/reset-link')).data;
  assert.equal((await call('GET', `/v1/reset/${token}`)).data.login, 'jane.doe');
  assert.equal((await call('POST', `/v1/reset/${token}`, { body: { password: 'reset-pass-1' } })).status, 200);
  assert.equal(gitea.users.get('jane.doe').password, 'reset-pass-1');
  assert.equal((await call('POST', `/v1/reset/${token}`, { body: { password: 'again-pass-1' } })).status, 410);
});

test('the emergency pause blocks invitations and is shown publicly', async () => {
  await staff('operator', 'POST', '/settings/service', { paused: true, message: 'maintenance' });
  const token = (await staff('operator', 'POST', '/students', {})).data.invitations[0].token;
  assert.deepEqual((await call('GET', `/v1/invite/${token}`)).data, { valid: false, paused: true });
  assert.equal((await call('GET', '/v1/public/status')).data.message, 'maintenance');
  await staff('operator', 'POST', '/settings/service', { paused: false });
  assert.equal((await call('GET', `/v1/invite/${token}`)).data.valid, true);
});

test('editing the terms asks everyone again; the contact fills the pages', async () => {
  const source = (await staff('operator', 'GET', '/settings')).data.pages.terms;
  assert.equal((await staff('operator', 'PUT', '/settings/pages/terms', { text: `${source}\n\nExtra.` })).data.termsVersion, 2);
  assert.equal((await call('GET', '/v1/student/me', { student: 'jane.doe' })).data.termsAccepted, false);
  await staff('operator', 'POST', '/settings/contact', { contact: 'hello@example.org' });
  assert.match((await call('GET', '/v1/public/pages/legal')).data.text, /hello@example\.org/);
});

test('export, then self-deletion removes the account and every trace of the login', async () => {
  gitea.repos.set('jane.doe', [{ name: 'c-course', updated_at: new Date().toISOString() }]);
  const exported = (await call('GET', '/v1/student/export', { student: 'jane.doe' })).data;
  assert.equal(exported.account.login, 'jane.doe');
  assert.deepEqual(exported.repositories, ['c-course']);
  const badPassword = await call('POST', '/v1/student/delete', { student: 'jane.doe', body: { confirm: 'jane.doe', password: 'nope' } });
  assert.equal(badPassword.status, 400);
  assert.equal((await call('POST', '/v1/student/delete', { student: 'jane.doe', body: { confirm: 'jane.doe', password: 'reset-pass-1' } })).status, 200);
  assert.ok(gitea.deleted.includes('jane.doe'));
  assert.equal((await call('GET', '/v1/student/me', { student: 'jane.doe' })).status, 401);
  const events = (await staff('operator', 'GET', '/activity')).data.events;
  assert.ok(!events.some((e) => e.student === 'jane.doe' || /\bjane\.doe\b/.test(e.detail ?? '')), 'no log line names the deleted account');
});
