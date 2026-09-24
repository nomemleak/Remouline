// Proxy used by the admin panel's client components. Only operators and maintainers
// get through (the API re-checks the role of the login on EVERY request), and the
// admin API token never leaves the server.
import { NextResponse, type NextRequest } from 'next/server';
import { getUser, isStaff } from '@/lib/auth';
import { adminApi, ApiError } from '@/lib/api';

type Ctx = { params: Promise<{ path: string[] }> };

async function handle(req: NextRequest, ctx: Ctx) {
  const user = await getUser();
  if (!user || !isStaff(user.role)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  // Same-origin check against CSRF (the session cookie is SameSite=Lax already).
  const origin = req.headers.get('origin');
  if (req.method !== 'GET' && origin && new URL(origin).host !== req.headers.get('host')) {
    return NextResponse.json({ error: 'bad origin' }, { status: 403 });
  }
  const { path } = await ctx.params;
  const target = `/${path.map(encodeURIComponent).join('/')}${req.nextUrl.search}`;
  try {
    const opts: { method: string; body?: unknown } = { method: req.method };
    if (req.method !== 'GET' && req.method !== 'DELETE') opts.body = await req.json().catch(() => ({}));
    const data = await adminApi(user.login, target, opts);
    return NextResponse.json(data);
  } catch (err) {
    const status = err instanceof ApiError ? err.status : 502;
    const message = err instanceof ApiError ? err.message : 'The Remouline API is unreachable.';
    return NextResponse.json({ error: message }, { status });
  }
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
