import Link from 'next/link';
import { requireStaff } from '@/lib/auth';
import { adminApi } from '@/lib/api';
import type { SubmissionStatus } from '@/lib/types';
import { formatDate } from '@/lib/format';
import { ErrorState } from '@/components/ErrorState';
import { SubmissionBadge } from '@/components/StatusBadge';
import { NewAssignmentForm } from './NewAssignmentForm';

export const metadata = { title: 'Assignments' };

type Overview = {
  role: 'operator' | 'maintainer';
  assignments: {
    slug: string; title: string; status: 'draft' | 'published'; validation_status: string;
    submissions: number; students: number; last_push: string | null; published_at: string | null; open_reports: number;
  }[];
  // Operators only:
  unrouted?: { id: number; student: string; assignment: string | null; repo_name: string; message: string; created_at: string }[];
  infraErrors?: { id: number; student: string; assignment: string | null; status: SubmissionStatus; message: string; created_at: string }[];
  queue?: { status: string; n: number }[];
  accessMode?: string;
};

const VALIDATION_TONE: Record<string, string> = { passed: 's-pass', failed: 's-fail', running: 's-running', none: 'faint' };

export default async function AdminHome() {
  const admin = await requireStaff();
  let data: Overview;
  try {
    data = await adminApi<Overview>(admin.login, '/overview');
  } catch (error) {
    return <ErrorState error={error} />;
  }
  const operator = data.role === 'operator';
  const queued = data.queue?.find((q) => q.status === 'queued')?.n ?? 0;
  const running = data.queue?.find((q) => q.status === 'running')?.n ?? 0;
  // Operators open the activity of an assignment, maintainers its testsuite.
  const target = (slug: string) => `/admin/assignments/${encodeURIComponent(slug)}${operator ? '' : '/tests'}`;

  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 'var(--s-1)' }}>
        <h1>Assignments</h1>
        {operator ? (
          <span className="small muted">
            Queue: {queued} queued · {running} running · access mode <strong>{data.accessMode}</strong>. Testsuites are imported
            by <Link href="/admin/maintainers">maintainers</Link>.
          </span>
        ) : (
          <span className="small muted">
            Import testsuite bundles, validate and publish them. Students stay anonymous: only totals are shown.
          </span>
        )}
      </div>

      <div className="card card-tight table-wrap">
        <table className="table">
          <thead>
            <tr><th>Assignment</th><th>Status</th><th>Validation</th><th>Reports</th><th>Students</th><th>Pushes</th><th>Last push</th></tr>
          </thead>
          <tbody>
            {data.assignments.length === 0 ? (
              <tr><td colSpan={7} className="muted">No assignment yet{operator ? '.' : ': create the first one below.'}</td></tr>
            ) : null}
            {data.assignments.map((a) => (
              <tr key={a.slug}>
                <td>
                  <Link href={target(a.slug)} style={{ fontWeight: 600 }}>{a.title}</Link>
                  <div className="small faint mono">{a.slug}</div>
                </td>
                <td><span className={`badge ${a.status === 'published' ? 's-pass' : 's-running'}`}>{a.status}</span></td>
                <td className={VALIDATION_TONE[a.validation_status] ?? ''}>{a.validation_status}</td>
                <td>
                  {a.open_reports > 0 && !operator ? (
                    <Link href={`/admin/assignments/${encodeURIComponent(a.slug)}/reports`} className="s-warn">{a.open_reports} open</Link>
                  ) : a.open_reports > 0 ? <span className="s-warn">{a.open_reports} open</span> : <span className="faint">—</span>}
                </td>
                <td>{a.students}</td>
                <td>{a.submissions}</td>
                <td>{formatDate(a.last_push)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {operator ? null : <NewAssignmentForm />}

      {data.infraErrors?.length ? (
        <section className="stack">
          <h3>Recent infrastructure errors</h3>
          <div className="card card-tight table-wrap">
            <table className="table">
              <tbody>
                {data.infraErrors.map((s) => (
                  <tr key={s.id}>
                    <td><Link href={`/admin/submissions/${s.id}`}>#{s.id}</Link></td>
                    <td className="mono">{s.student}</td>
                    <td className="mono">{s.assignment ?? '—'}</td>
                    <td><SubmissionBadge status={s.status} /></td>
                    <td className="small muted">{s.message}</td>
                    <td>{formatDate(s.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {data.unrouted?.length ? (
        <section className="stack">
          <h3>Pushes not matching any configured assignment</h3>
          <div className="card card-tight table-wrap">
            <table className="table">
              <tbody>
                {data.unrouted.map((s) => (
                  <tr key={s.id}>
                    <td><Link href={`/admin/submissions/${s.id}`}>#{s.id}</Link></td>
                    <td className="mono">{s.student}</td>
                    <td className="mono">{s.assignment ?? '—'}</td>
                    <td className="small muted">{s.message}</td>
                    <td>{formatDate(s.created_at)}</td>
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
