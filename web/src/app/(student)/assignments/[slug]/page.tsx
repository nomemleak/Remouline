import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { studentApi } from '@/lib/api';
import type { Submission, TestResult } from '@/lib/types';
import { formatDate, formatDuration, shortSha } from '@/lib/format';
import { SubmissionBadge } from '@/components/StatusBadge';
import { ErrorState } from '@/components/ErrorState';
import { AutoRefresh } from '@/components/AutoRefresh';
import { PushInstructions } from '@/components/PushInstructions';
import { ResultTree } from '@/components/ResultTree';
import { SubmissionMessage } from '@/components/SubmissionMessage';
import { ReportItem, type ReportingContext, type StudentReport } from '@/components/Reports';

type AssignmentData = {
  assignment: { slug: string; title: string | null };
  submissions: Submission[];
  pushCommand: string;
};

export default async function AssignmentPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await requireUser();
  let data: AssignmentData;
  let latest: { submission: Submission; results: TestResult[] } | null = null;
  let reporting: ReportingContext;
  try {
    data = await studentApi<AssignmentData>(user.login, `/assignments/${encodeURIComponent(slug)}`);
    const r = await studentApi<{ canParticipate: boolean; reports: StudentReport[] }>(user.login, `/assignments/${encodeURIComponent(slug)}/reports`);
    reporting = { slug, reports: r.reports, canParticipate: r.canParticipate };
    if (data.submissions[0]) {
      latest = await studentApi(user.login, `/submissions/${data.submissions[0].id}`);
    }
  } catch (error) {
    return <ErrorState error={error} />;
  }
  const pending = data.submissions.some((s) => ['queued', 'running'].includes(s.status));

  return (
    <div className="stack-lg">
      <AutoRefresh active={pending} />
      <div className="stack" style={{ gap: 'var(--s-1)' }}>
        <Link href="/" className="small">← Assignments</Link>
        <h1>{data.assignment.title || data.assignment.slug}</h1>
        <span className="small faint mono">{data.assignment.slug}</span>
      </div>

      {latest ? (
        <section className="stack">
          <div className="spread">
            <h2>Latest result</h2>
            <div className="row">
              <span className="small faint mono">{shortSha(latest.submission.commit_sha)} · {formatDate(latest.submission.created_at)}</span>
              <SubmissionBadge status={latest.submission.status} passed={latest.submission.passed} total={latest.submission.total} />
            </div>
          </div>
          <SubmissionMessage submission={latest.submission} />
          {latest.submission.status === 'done' ? <ResultTree key={latest.submission.id} results={latest.results} reporting={reporting} /> : null}
        </section>
      ) : (
        <div className="card muted">No attempt yet for this assignment. Use the command below from your repository.</div>
      )}

      {reporting.reports.length > 0 ? (
        <section className="stack">
          <h2>Reported tests</h2>
          <p className="small muted">
            Tests that students think are wrong. Vote to help the admin fix them quickly; to open a report, select a test in
            your results.
          </p>
          <div className="stack" style={{ gap: 'var(--s-2)' }}>
            {reporting.reports.map((r) => (
              <ReportItem key={r.id} report={r} slug={slug} canParticipate={reporting.canParticipate} />
            ))}
          </div>
        </section>
      ) : null}

      <PushInstructions command={data.pushCommand} paused={user.me.service.paused} />

      {data.submissions.length > 0 ? (
        <section className="stack">
          <h2>History</h2>
          <div className="card card-tight table-wrap">
            <table className="table">
              <thead>
                <tr><th>#</th><th>Pushed</th><th>Commit</th><th>Duration</th><th>Result</th></tr>
              </thead>
              <tbody>
                {data.submissions.map((s) => (
                  <tr key={s.id}>
                    <td><Link href={`/assignments/${encodeURIComponent(slug)}/submissions/${s.id}`}>#{s.id}</Link></td>
                    <td>{formatDate(s.created_at)}</td>
                    <td className="mono">{shortSha(s.commit_sha)}</td>
                    <td>{formatDuration(s.duration_ms)}</td>
                    <td><SubmissionBadge status={s.status} passed={s.passed} total={s.total} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
