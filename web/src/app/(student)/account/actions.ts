'use server';

import { getUser } from '@/lib/auth';
import { studentApi, ApiError } from '@/lib/api';

const message = (err: unknown) => (err instanceof ApiError ? err.message : 'Something went wrong, try again later.');

export async function changePasswordAction(form: FormData): Promise<{ ok?: boolean; error?: string }> {
  const user = await getUser();
  if (!user) return { error: 'Your session expired: log in again.' };
  const next = String(form.get('next') ?? '');
  if (next !== String(form.get('confirm') ?? '')) return { error: 'The two new passwords are different.' };
  try {
    await studentApi(user.login, '/password', { method: 'POST', body: { current: String(form.get('current') ?? ''), next } });
    return { ok: true };
  } catch (err) {
    return { error: message(err) };
  }
}

export async function deleteAccountAction(confirm: string, password: string): Promise<{ ok?: boolean; error?: string }> {
  const user = await getUser();
  if (!user) return { error: 'Your session expired: log in again.' };
  try {
    await studentApi(user.login, '/delete', { method: 'POST', body: { confirm, password } });
    return { ok: true };
  } catch (err) {
    return { error: message(err) };
  }
}
