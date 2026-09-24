'use server';

import { redirect } from 'next/navigation';
import { getUser } from '@/lib/auth';
import { studentApi } from '@/lib/api';

export async function acceptTermsAction() {
  const user = await getUser();
  if (!user) redirect('/login');
  await studentApi(user.login, '/terms/accept', { method: 'POST' });
  redirect(user.role === 'student' ? '/' : '/admin');
}
