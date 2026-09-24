// Login form of the dashboard: the login/password pair is checked by the API against
// Gitea over the internal network (Gitea itself is never shown to users). The session
// is a signed, httpOnly JWT cookie holding the login and role; every server route
// derives the user from it, never from client input, and the API re-checks the role
// on every admin request.
import 'server-only';
import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { MOCK_MODE, MOCK_COOKIE, MOCK_USERS, type MockUser, type Role } from './mock/mode';
import { authApi, studentApi, ApiError } from './api';

export type { Role };
export type SessionUser = { login: string; role: Role };

function clientIp(headers: Record<string, unknown> | undefined): string | null {
  const pick = (name: string) => {
    const v = headers?.[name];
    return typeof v === 'string' ? v : Array.isArray(v) && typeof v[0] === 'string' ? v[0] : null;
  };
  return pick('cf-connecting-ip') ?? pick('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
}

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  session: { strategy: 'jwt', maxAge: 8 * 60 * 60 },
  pages: { signIn: '/login', error: '/login' },
  providers: [
    CredentialsProvider({
      id: 'credentials',
      name: 'Login',
      credentials: { login: { type: 'text' }, password: { type: 'password' } },
      async authorize(credentials, req) {
        try {
          const user = await authApi<SessionUser>({
            login: credentials?.login ?? '',
            password: credentials?.password ?? '',
            clientIp: clientIp(req?.headers as Record<string, unknown> | undefined),
          });
          return { id: user.login, login: user.login, role: user.role };
        } catch (err) {
          // The message is shown on the login page (wrong password, too many attempts...).
          throw new Error(err instanceof ApiError ? err.message : 'The service is unreachable, try again later.');
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user && 'login' in user) {
        token.login = (user as unknown as SessionUser).login;
        token.role = (user as unknown as SessionUser).role;
      }
      return token;
    },
    async session({ session, token }) {
      session.user = { login: typeof token.login === 'string' ? token.login : '', role: (token.role as Role) ?? 'student' };
      return session;
    },
  },
};

export async function getUser(): Promise<SessionUser | null> {
  if (MOCK_MODE) {
    // Local mock mode only: the "session" is a plain cookie choosing a fake user.
    const key = (await cookies()).get(MOCK_COOKIE)?.value as MockUser | undefined;
    return key && key in MOCK_USERS ? { ...MOCK_USERS[key] } : null;
  }
  const session = await getServerSession(authOptions);
  const user = session?.user as SessionUser | undefined;
  return user?.login ? user : null;
}

export type Me = {
  login: string;
  role: Role;
  email: string | null;
  createdAt: string;
  termsAccepted: boolean;
  termsVersion: number;
  accessMode: string;
  service: { paused: boolean; message: string | null };
  pushCommand: string;
};

/**
 * For pages: the verified user, or a redirect to the login screen. Also enforces the
 * terms of use: an account that has not accepted the current version is sent to
 * /terms/accept first.
 */
export async function requireUser(): Promise<SessionUser & { me: Me }> {
  const user = await getUser();
  if (!user) redirect('/login');
  let me: Me;
  try {
    me = await studentApi<Me>(user.login, '/me');
  } catch (err) {
    // Deleted or disabled account: back to the login page.
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) redirect('/login?error=disabled');
    throw err;
  }
  if (!me.termsAccepted) redirect('/terms/accept');
  return { ...user, role: me.role, me };
}

/** For admin pages: operators and maintainers, re-checked on every request. */
export async function requireStaff(...roles: Role[]): Promise<SessionUser & { me: Me }> {
  const user = await requireUser();
  const allowed = roles.length ? roles : ['operator', 'maintainer'];
  if (!allowed.includes(user.role)) redirect(user.role === 'student' ? '/' : '/admin');
  return user;
}

export const isStaff = (role?: Role) => role === 'operator' || role === 'maintainer';
