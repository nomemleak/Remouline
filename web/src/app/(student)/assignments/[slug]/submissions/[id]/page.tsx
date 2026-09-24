import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { studentApi } from '@/lib/api';
import type { Submission, TestResult } from '@/lib/types';
import { formatDate, formatDuration, shortSha } from '@/lib/format';
import { SubmissionBadge } from '@/components/StatusBadge';
import { ErrorState } from '@/components/ErrorState';
import { AutoRefresh } from '@/components/AutoRefresh';
import { ResultTree } from '@/components/ResultTree';
import { SubmissionMessage } from '@/components/SubmissionMessage';
import type { ReportingContext, StudentReport } from '@/components/Reports';

export default async function SubmissionPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const user = await requireUser();
  let data: { submission: Submission; results: TestResult[] };
  let reporting: ReportingContext;
  try {
    // The API only returns this submission if it belongs to the logged-in student.
    data = await studentApi(user.login, `/submissions/${encodeURIComponent(id)}`);
    const r = await studentApi<{ canParticipate: boolean; reports: StudentReport[] }>(user.login, `/assignments/${encodeURIComponent(slug)}/reports`);
    reporting = { slug, reports: r.reports, canParticipate: r.canParticipate };
  } catch (error) {
    return <ErrorState error={error} />;
  }
  const s = data.submission;
  if (s.assignment !== slug) notFound();
  return (
    <div className="stack-lg">
      <AutoRefresh active={['queued', 'running'].includes(s.status)} />
      <div className="stack" style={{ gap: 'var(--s-1)' }}>
        <Link href={`/assignments/${encodeURIComponent(slug)}`} className="small">← {slug}</Link>
        <div className="spread">
          <h1>Submission #{s.id}</h1>
          <SubmissionBadge status={s.status} passed={s.passed} total={s.total} />
        </div>
        <span className="small faint mono">
          {s.repo_name} @ {shortSha(s.commit_sha)} · pushed {formatDate(s.created_at)} · {formatDuration(s.duration_ms)}
        </span>
      </div>
      <SubmissionMessage submission={s} />
      {s.status === 'done' ? <ResultTree results={data.results} reporting={reporting} /> : null}
    </div>
  );
}
