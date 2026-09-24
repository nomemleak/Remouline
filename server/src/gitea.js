// Minimal Gitea API client, over the internal Docker network only (Gitea's web UI and
// API are never exposed to users). Gitea stays the single account system: Remouline
// never stores passwords, it checks them against Gitea and drives its admin API.
import crypto from 'node:crypto';
import { config, secret } from './config.js';

export class GiteaError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function request(method, route, body, token = secret('GITEA_ADMIN_TOKEN')) {
  const res = await fetch(`${config.giteaInternalUrl}/api/v1${route}`, {
    method,
    headers: {
      Authorization: `token ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    const message = (data && data.message) || text || res.statusText;
    throw new GiteaError(res.status, `Gitea ${method} ${route} failed (${res.status}): ${message}`);
  }
  return data;
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// Random password for accounts created without one (never shown to anyone).
export function generateTempPassword() {
  return crypto.randomBytes(12).toString('base64url');
}

// Gitea requires an email: accounts created without one get a placeholder that can
// never receive mail (no mailer is configured anyway).
export const placeholderEmail = (login) => `${login}@noreply.localhost`;

/**
 * Creates the Gitea account with the password chosen by the user on the invitation
 * page (or a random one if none is given). The email is optional.
 */
export async function createUser({ login, email = null, password = null }) {
  const chosen = typeof password === 'string' && password.length > 0;
  await request('POST', '/admin/users', {
    username: login,
    login_name: login,
    email: email || placeholderEmail(login),
    password: chosen ? password : generateTempPassword(),
    must_change_password: false,
    send_notify: false,
    source_id: 0,
    visibility: 'private',
  });
  return { login };
}

/** The account's exact login if the login/password pair is valid and may log in, else null. */
export async function verifyPassword(login, password) {
  const res = await fetch(`${config.giteaInternalUrl}/api/v1/user`, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${login}:${password}`).toString('base64')}`,
      Accept: 'application/json',
    },
  });
  if (res.status === 401 || res.status === 403) return null;
  if (!res.ok) throw new GiteaError(res.status, `Gitea login check failed (${res.status})`);
  const user = await res.json();
  return String(user.login).toLowerCase() === String(login).toLowerCase() ? user.login : null;
}

export async function setPassword(login, password) {
  await request('PATCH', `/admin/users/${encodeURIComponent(login)}`, {
    login_name: login,
    source_id: 0,
    password,
    must_change_password: false,
  });
}

/** Deletes the account AND everything it owns (repositories included). */
export async function deleteUser(login) {
  try {
    await request('DELETE', `/admin/users/${encodeURIComponent(login)}?purge=true`);
  } catch (err) {
    if (err.status !== 404) throw err;
  }
}

export async function deleteRepo(owner, repo) {
  try {
    await request('DELETE', `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
  } catch (err) {
    if (err.status !== 404) throw err;
  }
}

export async function getUser(login) {
  return request('GET', `/users/${encodeURIComponent(login)}`);
}

export async function listUsers() {
  const users = [];
  for (let page = 1; ; page += 1) {
    const batch = await request('GET', `/admin/users?limit=50&page=${page}`);
    users.push(...batch);
    if (batch.length < 50) break;
  }
  return users;
}

export async function setLoginAllowed(login, allowed) {
  await request('PATCH', `/admin/users/${encodeURIComponent(login)}`, {
    login_name: login,
    source_id: 0,
    prohibit_login: !allowed,
  });
}

export async function listUserRepos(login) {
  const repos = [];
  for (let page = 1; ; page += 1) {
    const batch = await request('GET', `/users/${encodeURIComponent(login)}/repos?limit=50&page=${page}`);
    repos.push(...batch);
    if (batch.length < 50) break;
  }
  return repos;
}

// Clone URL used by the worker, over the VM's internal network (never through the tunnel).
export function internalCloneUrl(owner, repo) {
  return `${config.giteaInternalUrl}/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}.git`;
}

export { request as giteaRequest };
