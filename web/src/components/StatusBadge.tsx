import { IconAlert, IconCheck, IconClock, IconCross } from './Icons';
import { SUBMISSION_LABELS, submissionTone, type Tone } from '@/lib/format';
import type { SubmissionStatus } from '@/lib/types';

export const TONE_ICON: Record<Tone, (p: { size?: number }) => React.ReactElement> = {
  pass: IconCheck,
  fail: IconCross,
  warn: IconAlert,
  running: IconClock,
};

export function SubmissionBadge({ status, passed, total }: { status: SubmissionStatus; passed?: number | null; total?: number | null }) {
  const tone = submissionTone(status, passed, total);
  const Icon = TONE_ICON[tone];
  const label = status === 'done' ? `${passed ?? 0} / ${total ?? 0}` : SUBMISSION_LABELS[status];
  return (
    <span className={`badge s-${tone}`}>
      <Icon size={12} />
      {label}
    </span>
  );
}
