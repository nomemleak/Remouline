import Link from 'next/link';
import { requireStaff } from '@/lib/auth';
import { adminApi } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { ErrorState } from '@/components/ErrorState';
import { CreateStudents } from './CreateStudents';

export const metadata = { title: 'Students' };

type Student = {
  login: string; email: string | null; active: number; created_via: string; invited_by: string | null;
  created_at: string; last_login_at: string | null; submissions: number; last_push: string | null;
};

export default async function StudentsPage() {
  const admin = await requireStaff('operator');
  let data: { students: Student[] };
  try {
    data = await adminApi(admin.login, '/students');
  } catch (error) {
    return <ErrorState error={error} />;
  }
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 'var(--s-1)' }}>
        <h1>Students</h1>
        <span className="small muted">Student accounts. Maintainers and operators are listed separately. Inactive accounts are deleted automatically (see Settings).</span>
      </div>
      <div className="card card-tight table-wrap">
        <table className="table">
          <thead>
            <tr><th>Login</th><th>Status</th><th>Origin</th><th>Invited by</th><th>Pushes</th><th>Last push</th><th>Last login</th></tr>
          </thead>
          <tbody>
            {data.students.length === 0 ? <tr><td colSpan={7} className="muted">No student yet.</td></tr> : null}
            {data.students.map((s) => (
              <tr key={s.login}>
                <td className="mono"><Link href={`/admin/students/${encodeURIComponent(s.login)}`}>{s.login}</Link></td>
                <td className={s.active ? 's-pass' : 's-fail'}>{s.active ? 'active' : 'disabled'}</td>
                <td className="small muted">{s.created_via}</td>
                <td className="mono small">{s.invited_by ?? '—'}</td>
                <td>{s.submissions}</td>
                <td>{formatDate(s.last_push)}</td>
                <td>{formatDate(s.last_login_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <CreateStudents />
    </div>
  );
}
