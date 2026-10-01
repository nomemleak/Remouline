import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { studentApi } from '@/lib/api';
import type { AssignmentSummary, Submission } from '@/lib/types';
import { formatDate, shortSha } from '@/lib/format';
import { SubmissionBadge } from '@/components/StatusBadge';
import { ErrorState } from '@/components/ErrorState';
import { AutoRefresh } from '@/components/AutoRefresh';
import { PushInstructions } from '@/components/PushInstructions';
import { IndependentNotice } from '@/components/Notices';
import { IconChevronRight } from '@/components/Icons';

export const metadata = { title: 'Assignments' };

export default async function HomePage() {
  const user = await requireUser();
  let data: { assignments: AssignmentSummary[]; unrouted: Submission[]; inProgress?: Submission[] };
  try {
    data = await studentApi<{ assignments: AssignmentSummary[]; unrouted: Submission[]; inProgress?: Submission[] }>(user.login, '/assignments');
  } catch (error) {
    return <ErrorState error={error} />;
  }
  const inProgress = data.inProgress ?? [];
  const pending = inProgress.length > 0 || data.assignments.some((a) => a.latest && ['queued', 'running'].includes(a.latest.status));

  return (
    <div className="stack-lg">
      <AutoRefresh active={pending} />
      <div className="stack" style={{ gap: 'var(--s-2)' }}>
        <h1>Assignments</h1>
        <p className="muted">Each assignment has its own testsuite and its own history.</p>
        <IndependentNotice />
      </div>

      {data.assignments.length === 0 ? (
        <div className="card muted">No assignment is open for testing yet.</div>
      ) : (
        <div className="stack" style={{ gap: 'var(--s-2)' }}>
          {data.assignments.map((a) => (
            <Link key={a.slug} href={`/assignments/${encodeURIComponent(a.slug)}`} className="card card-tight spread" style={{ color: 'inherit' }}>
              <div className="stack" style={{ gap: 2 }}>
                <span style={{ fontWeight: 600 }}>{a.title || a.slug}</span>
                <span className="small faint mono">{a.slug}</span>
              </div>
              <div className="row">
                {a.latest ? (
                  <>
                    <span className="small faint">{a.attempts} attempt{a.attempts > 1 ? 's' : ''} · last {formatDate(a.latest.created_at)}</span>
                    <SubmissionBadge status={a.latest.status} passed={a.latest.passed} total={a.latest.total} />
                  </>
                ) : (
                  <span className="small faint">No attempt yet</span>
                )}
                <IconChevronRight className="faint" />
              </div>
            </Link>
          ))}
        </div>
      )}

      {inProgress.length > 0 ? (
        <section className="stack">
          <h3>Being graded</h3>
          <div className="stack" style={{ gap: 'var(--s-2)' }}>
            {inProgress.map((s) => (
              <div key={s.id} className="card card-tight spread">
                <span className="mono small">{s.repo_name} @ {shortSha(s.commit_sha)}</span>
                <span className="small faint">
                  {s.status === 'running' ? 'Running' : 'Queued'}{s.message ? ` · ${s.message}` : ''} · {formatDate(s.created_at)}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {data.unrouted.length > 0 ? (
        <section className="stack">
          <h3>Pushes that could not be graded</h3>
          <div className="stack" style={{ gap: 'var(--s-2)' }}>
            {data.unrouted.map((s) => (
              <div key={s.id} className="notice">
                <div className="spread">
                  <span className="mono small">{s.repo_name} @ {shortSha(s.commit_sha)}</span>
                  <span className="small faint">{formatDate(s.created_at)}</span>
                </div>
                <p className="small" style={{ marginTop: 'var(--s-1)' }}>{s.message || 'This push does not match any open assignment.'}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <PushInstructions command={user.me.pushCommand} paused={user.me.service.paused} />
    </div>
  );
}
