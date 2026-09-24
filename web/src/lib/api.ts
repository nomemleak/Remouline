// Server-side client for the Remouline API, reached over the internal Docker network
// (never through the Internet). `server-only` guarantees the tokens never end up in a
// browser bundle. The user login passed here ALWAYS comes from the verified session
// (see lib/auth.ts), never from request parameters.
import 'server-only';
import { MOCK_MODE } from './mock/mode';

const baseUrl = () => (process.env.REMOULINE_API_URL || 'http://api:8080').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type Options = { method?: string; body?: unknown };

async function call<T>(path: string, token: string, headers: Record<string, string>, opts: Options = {}): Promise<T> {
  const init: RequestInit = {
    method: opts.method ?? 'GET',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...headers },
    cache: 'no-store',
  };
  if (opts.body !== undefined) {
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }
  const res = await fetch(`${baseUrl()}${path}`, init);
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }
  if (!res.ok) {
    const message = (data as { error?: string } | null)?.error || res.statusText;
    throw new ApiError(res.status, message);
  }
  return data as T;
}

type Scope = 'student' | 'admin' | 'public';

// Local mock mode (`npm run dev:mock` only, dead code in production builds): see lib/mock/mode.ts.
async function mock<T>(scope: Scope, login: string, path: string, opts?: Options): Promise<T> {
  const { mockCall } = await import('./mock/api');
  return (await mockCall(scope, login, path, opts)) as T;
}

const userToken = () => process.env.REMOULINE_API_TOKEN || '';

export function studentApi<T = unknown>(login: string, path: string, opts?: Options) {
  if (MOCK_MODE) return mock<T>('student', login, path, opts);
  return call<T>(`/v1/student${path}`, userToken(), { 'X-Remouline-Student': login }, opts);
}

export function adminApi<T = unknown>(login: string, path: string, opts?: Options) {
  if (MOCK_MODE) return mock<T>('admin', login, path, opts);
  return call<T>(`/v1/admin${path}`, process.env.REMOULINE_ADMIN_API_TOKEN || '', { 'X-Remouline-Admin': login }, opts);
}

/** Routes that need no session: login, status, legal pages, invitation and reset links. */
export function publicApi<T = unknown>(path: string, opts?: Options) {
  if (MOCK_MODE) return mock<T>('public', '', path, opts);
  return call<T>(`/v1${path}`, userToken(), {}, opts);
}

export function authApi<T = unknown>(body: { login: string; password: string; clientIp: string | null }) {
  return publicApi<T>('/auth/login', { method: 'POST', body });
}
