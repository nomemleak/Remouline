'use server';

import { publicApi, ApiError } from '@/lib/api';

export type ResetResult = { login?: string; error?: string };

export async function resetAction(token: string, form: FormData): Promise<ResetResult> {
  const password = String(form.get('password') ?? '');
  if (password !== String(form.get('confirm') ?? '')) return { error: 'The two passwords are different.' };
  try {
    return await publicApi<ResetResult>(`/reset/${encodeURIComponent(token)}`, { method: 'POST', body: { password } });
  } catch (err) {
    return { error: err instanceof ApiError ? err.message : 'Something went wrong, try again later.' };
  }
}
