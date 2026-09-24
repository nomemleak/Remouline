'use server';

import { revalidatePath } from 'next/cache';
import { getUser } from '@/lib/auth';
import { studentApi, ApiError } from '@/lib/api';

// Server actions re-derive the student from the session on every call.
export async function createInviteAction(): Promise<{ url?: string; expiresAt?: string; error?: string }> {
  const user = await getUser();
  if (!user) return { error: 'Not logged in.' };
  try {
    const inv = await studentApi<{ token: string; expiresAt: string }>(user.login, '/invitations', { method: 'POST', body: {} });
    revalidatePath('/invites');
    const base = (process.env.NEXTAUTH_URL || 'http://localhost:3000').replace(/\/$/, '');
    return { url: `${base}/invite/${inv.token}`, expiresAt: inv.expiresAt };
  } catch (err) {
    return { error: err instanceof ApiError ? err.message : 'Could not create the invitation.' };
  }
}

export async function revokeInviteAction(id: number) {
  const user = await getUser();
  if (!user) return;
  await studentApi(user.login, `/invitations/${Number(id)}`, { method: 'DELETE' }).catch(() => {});
  revalidatePath('/invites');
}
