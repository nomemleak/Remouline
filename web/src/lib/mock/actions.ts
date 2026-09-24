'use server';

// Fake sign-in / sign-out for the local mock mode. Refuses to do anything otherwise.
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { MOCK_MODE, MOCK_COOKIE, MOCK_USERS, type MockUser } from './mode';

export async function mockSignIn(user: MockUser) {
  if (!MOCK_MODE || !(user in MOCK_USERS)) throw new Error('Mock mode is disabled.');
  (await cookies()).set(MOCK_COOKIE, user, { httpOnly: true, sameSite: 'lax', path: '/' });
  redirect(MOCK_USERS[user].role === 'student' ? '/' : '/admin');
}

export async function mockSignOut() {
  if (!MOCK_MODE) throw new Error('Mock mode is disabled.');
  (await cookies()).delete(MOCK_COOKIE);
  redirect('/login');
}
