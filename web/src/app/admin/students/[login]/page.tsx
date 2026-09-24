import Link from 'next/link';
import { requireStaff } from '@/lib/auth';
import { adminApi } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { ErrorState } from '@/components/ErrorState';
import { CommandBox } from '@/components/CopyButton';
import { StudentActions } from './StudentActions';

type Detail = {
  student: { login: string; email: string | null; active: number; created_via: string; invited_by: string | null; created_at: string; last_login_at: string | null };
  gitea: { prohibit_login?: boolean; created?: string; error?: string };
  repos: { name: string; private: boolean; updated_at: string }[];
  assignments: { assignment: string | null; attempts: number; last_push: string }[];
  invitees: { login: string; active: number; created_at: string }[];
  pushCommand: string;
};

export default async function StudentPage({ params }: { params: Promise<{ login: string }> }) {
  const { login } = await params;
  const admin = await requireStaff('operator');
  let d: Detail;
  try {
    d = await adminApi<Detail>(admin.login, `/students/${encodeURIComponent(login)}`);
  } catch (error) {
    return <ErrorState error={error} />;
  }
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 'var(--s-1)' }}>
        <Link href="/admin/students" className="small">← Students</Link>
        <div className="spread">
          <h1 className="mono">{d.student.login}</h1>
          <StudentActions login={d.student.login} active={Boolean(d.student.active)} />
        </div>
        <span className="small faint">
          {d.student.email ?? 'no email'} · {d.student.active ? 'active' : 'disabled'} · created {formatDate(d.student.created_at)} via {d.student.created_via}
          {d.student.invited_by ? <> · invited by <Link href={`/admin/students/${encodeURIComponent(d.student.invited_by)}`}>{d.student.invited_by}</Link></> : null}
        </span>
        {d.gitea.error ? <div className="notice error">Git server: {d.gitea.error}</div> : null}
      </div>

      <section className="card stack">
        <h3>Personal push command</h3>
        <CommandBox command={d.pushCommand} />
      </section>

      <div>
        <section className="card stack">
          <h3>Access</h3>
          <div className="small">
            <div className="caption">Assignments pushed</div>
            {d.assignments.length === 0 ? <p className="muted">None.</p> : null}
            {d.assignments.map((a) => (
              <div key={a.assignment ?? 'none'} className="spread">
                <span className="mono">{a.assignment ?? '(unresolved)'}</span>
                <span className="faint">{a.attempts} push(es) · {formatDate(a.last_push)}</span>
              </div>
            ))}
          </div>
          <div className="small">
            <div className="caption">Git repositories</div>
            {d.repos.map((r) => <div key={r.name} className="mono">{r.name}</div>)}
          </div>
          <div className="small">
            <div className="caption">People invited</div>
            {d.invitees.length === 0 ? <p className="muted">None.</p> : null}
            {d.invitees.map((i) => (
              <div key={i.login}><Link href={`/admin/students/${encodeURIComponent(i.login)}`} className="mono">{i.login}</Link> {i.active ? '' : '(disabled)'}</div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
