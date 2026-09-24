'use server';

// Report / vote actions. The student is always derived from the verified session.
import { revalidatePath } from 'next/cache';
import { getUser } from '@/lib/auth';
import { studentApi, ApiError } from '@/lib/api';

type Result = { ok?: boolean; error?: string };

export async function createReportAction(slug: string, resultId: number, message: string): Promise<Result> {
  const user = await getUser();
  if (!user) return { error: 'Not logged in.' };
  try {
    await studentApi(user.login, `/assignments/${encodeURIComponent(slug)}/reports`, {
      method: 'POST',
      body: { resultId: Number(resultId), message: String(message) },
    });
    revalidatePath(`/assignments/${encodeURIComponent(slug)}`, 'layout');
    return { ok: true };
  } catch (err) {
    return { error: err instanceof ApiError ? err.message : 'Could not send the report.' };
  }
}

export async function voteReportAction(slug: string, reportId: number, vote: 1 | -1 | 0): Promise<Result> {
  const user = await getUser();
  if (!user) return { error: 'Not logged in.' };
  try {
    await studentApi(user.login, `/reports/${Number(reportId)}/vote`, { method: 'POST', body: { vote } });
    revalidatePath(`/assignments/${encodeURIComponent(slug)}`, 'layout');
    return { ok: true };
  } catch (err) {
    return { error: err instanceof ApiError ? err.message : 'Could not save your vote.' };
  }
}
