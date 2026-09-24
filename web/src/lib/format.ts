import type { LeafStatus, SubmissionStatus } from './types';

export type Tone = 'pass' | 'fail' | 'warn' | 'running';

export const SUBMISSION_LABELS: Record<SubmissionStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  done: 'Graded',
  infra_error: 'Infrastructure error',
  not_configured: 'Assignment not configured',
  timeout: 'Timed out',
};

export const LEAF_LABELS: Record<LeafStatus, string> = {
  pass: 'Passed',
  fail: 'Failed',
  crash: 'Crashed',
  timeout: 'Timeout',
  memory_error: 'Memory errors',
  skipped: 'Not run',
  error: 'Testsuite error',
};

export function submissionTone(status: SubmissionStatus, passed?: number | null, total?: number | null): Tone {
  if (status === 'queued' || status === 'running') return 'running';
  if (status === 'done') return total && passed === total ? 'pass' : 'fail';
  if (status === 'infra_error' || status === 'not_configured') return 'warn';
  return 'fail';
}

export function leafTone(status: LeafStatus, valgrindOk: number | null): Tone {
  if (status === 'pass') return valgrindOk === 0 ? 'fail' : 'pass';
  if (status === 'skipped' || status === 'error') return 'warn';
  return 'fail';
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit',
    timeZone: process.env.NEXT_PUBLIC_TIMEZONE || 'Europe/Paris',
  });
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(1)} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
}

export const shortSha = (sha: string | null | undefined) => (sha ? sha.slice(0, 10) : '—');
