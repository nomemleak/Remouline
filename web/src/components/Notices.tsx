// Notices shown to every user: the emergency pause message, the "independent,
// indicative results" reminder and the links to the terms / privacy / legal pages.
import Link from 'next/link';
import { publicApi } from '@/lib/api';
import { APP_NAME } from '@/lib/app';
import { IconAlert } from './Icons';

type Status = { paused: boolean; message: string | null };

export async function ServiceBanner({ status }: { status?: Status }) {
  const state = status ?? (await publicApi<Status>('/public/status').catch(() => null));
  if (!state?.paused) return null;
  return (
    <div className="notice error row" role="status">
      <IconAlert /> <span>{state.message}</span>
    </div>
  );
}

export function IndependentNotice() {
  return (
    <p className="small faint">
      {APP_NAME} is an independent, non-commercial service, not affiliated with any school or course. Results are indicative
      only: they are not a grade, and only the evaluation of your course counts.
    </p>
  );
}

export function PublicFooter() {
  return (
    <footer className="row small faint" style={{ justifyContent: 'center', gap: 'var(--s-4)', flexWrap: 'wrap' }}>
      <span>Independent, non-commercial service</span>
      <Link href="/terms" className="faint">Terms of use</Link>
      <Link href="/privacy" className="faint">Privacy</Link>
      <Link href="/legal" className="faint">Legal notice</Link>
    </footer>
  );
}
