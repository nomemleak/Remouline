import type { Submission } from '@/lib/types';
import { escapeForDisplay } from '@/lib/escape';

const EXPLANATIONS: Partial<Record<Submission['status'], string>> = {
  queued: 'Your push is waiting in the queue.',
  running: 'Your code is being compiled and tested…',
  infra_error: 'The grading server had a problem unrelated to your code. The administrator can re-run it; you do not need to push again.',
  not_configured: 'This push could not be matched to an open assignment.',
  timeout: 'The whole correction took too long and was stopped.',
};

export function SubmissionMessage({ submission }: { submission: Submission }) {
  const explanation = EXPLANATIONS[submission.status];
  if (!explanation && !submission.message) return null;
  const tone = submission.status === 'infra_error' || submission.status === 'timeout' ? 'error' : '';
  return (
    <div className={`notice ${tone}`}>
      {explanation ? <p>{explanation}</p> : null}
      {submission.message ? <p className="small muted mono" style={{ marginTop: 4 }}>{escapeForDisplay(submission.message)}</p> : null}
    </div>
  );
}
