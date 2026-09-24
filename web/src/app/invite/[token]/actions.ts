'use server';

import { publicApi, ApiError } from '@/lib/api';

export type RedeemResult = { login?: string; error?: string };

export async function redeemAction(token: string, form: FormData): Promise<RedeemResult> {
  const password = String(form.get('password') ?? '');
  if (password !== String(form.get('confirm') ?? '')) return { error: 'The two passwords are different.' };
  if (form.get('acceptTerms') !== 'on') return { error: 'You must accept the terms of use to create an account.' };
  try {
    return await publicApi<RedeemResult>(`/invite/${encodeURIComponent(token)}/redeem`, {
      method: 'POST',
      body: {
        login: String(form.get('login') ?? '').trim(),
        email: String(form.get('email') ?? '').trim(),
        password,
        acceptTerms: true,
      },
    });
  } catch (err) {
    return { error: err instanceof ApiError ? err.message : 'Something went wrong, try again later.' };
  }
}
