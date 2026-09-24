import Link from 'next/link';
import { requireStaff } from '@/lib/auth';
import { adminApi } from '@/lib/api';
import type { Submission } from '@/lib/types';
import { SUBMISSION_LABELS, formatDate, formatDuration, shortSha } from '@/lib/format';
import { ErrorState } from '@/components/ErrorState';
import { SubmissionBadge } from '@/components/StatusBadge';
import { AutoRefresh } from '@/components/AutoRefresh';
import { AssignmentHeader } from './AssignmentHeader';

type Feed = {
  submissions: Submission[];
  students: string[];
  events: { id: number; event_type: string; student: string | null; detail: string | null; timestamp: string }[];
};

export default async function AssignmentActivity({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ student?: string; status?: string; q?: string }>;
}) {
  const { slug } = await params;
  const filters = await searchParams;
  const admin = await requireStaff('operator');
  const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v) as [string, string][]).toString();
  let feed: Feed;
  let assignment: { title: string; status: string };
  try {
    [feed, { assignment }] = await Promise.all([
      adminApi<Feed>(admin.login, `/assignments/${encodeURIComponent(slug)}/feed${qs ? `?${qs}` : ''}`),
      adminApi<{ assignment: { title: string; status: string } }>(admin.login, `/assignments/${encodeURIComponent(slug)}`),
    ]);
  } catch (error) {
    return <ErrorState error={error} />;
  }
  const pending = feed.submissions.some((s) => ['queued', 'running'].includes(s.status));

  return (
    <div className="stack-lg">
      <AutoRefresh active={pending} />
      <AssignmentHeader slug={slug} title={assignment.title} status={assignment.status} tab="activity" role={admin.role} />

      <form className="row" method="get">
        <select className="select" name="student" defaultValue={filters.student ?? ''} style={{ width: 200 }}>
          <option value="">All students</option>
          {feed.students.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="select" name="status" defaultValue={filters.status ?? ''} style={{ width: 220 }}>
          <option value="">All statuses</option>
          {Object.entries(SUBMISSION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input className="input" name="q" defaultValue={filters.q ?? ''} placeholder="Search login, repo, commit, message" style={{ width: 280 }} />
        <button className="btn">Filter</button>
        {qs ? <Link href={`/admin/assignments/${encodeURIComponent(slug)}`} className="btn btn-ghost">Reset</Link> : null}
      </form>

      <div className="card card-tight table-wrap">
        <table className="table">
          <thead>
            <tr><th>#</th><th>Student</th><th>Pushed</th><th>Commit</th><th>Duration</th><th>Status</th><th>Message</th></tr>
          </thead>
          <tbody>
            {feed.submissions.length === 0 ? <tr><td colSpan={7} className="muted">No submission.</td></tr> : null}
            {feed.submissions.map((s) => (
              <tr key={s.id}>
                <td><Link href={`/admin/submissions/${s.id}`}>#{s.id}</Link></td>
                <td className="mono"><Link href={`/admin/students/${encodeURIComponent(s.student ?? '')}`} style={{ color: 'inherit' }}>{s.student}</Link></td>
                <td>{formatDate(s.created_at)}</td>
                <td className="mono">{shortSha(s.commit_sha)}</td>
                <td>{formatDuration(s.duration_ms)}</td>
                <td><SubmissionBadge status={s.status} passed={s.passed} total={s.total} /></td>
                <td className="small muted" style={{ maxWidth: 320 }}>{s.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {feed.events.length > 0 ? (
        <section className="stack">
          <h3>Events on this assignment</h3>
          <div className="card card-tight table-wrap">
            <table className="table">
              <tbody>
                {feed.events.map((e) => (
                  <tr key={e.id}>
                    <td>{formatDate(e.timestamp)}</td>
                    <td className="mono">{e.student}</td>
                    <td className="small muted">{e.detail}</td>
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
