import { requireStaff } from '@/lib/auth';
import { adminApi } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { ErrorState } from '@/components/ErrorState';
import { StudentActions } from '../students/[login]/StudentActions';
import { InviteMaintainer } from './InviteMaintainer';
import { RevokeInvitation } from '../access/AccessControls';

export const metadata = { title: 'Maintainers' };

type Data = {
  maintainers: { login: string; active: number; created_at: string; last_login_at: string | null }[];
  invitations: { id: number; preset_login: string | null; created_at: string; expires_at: string; used_at: string | null; revoked_at: string | null }[];
};

export default async function MaintainersPage() {
  const admin = await requireStaff('operator');
  let data: Data;
  try {
    data = await adminApi<Data>(admin.login, '/maintainers');
  } catch (error) {
    return <ErrorState error={error} />;
  }
  const pending = data.invitations.filter((i) => !i.used_at && !i.revoked_at && new Date(i.expires_at) > new Date());
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 'var(--s-1)' }}>
        <h1>Maintainers</h1>
        <p className="small muted">
          Maintainers import, validate and publish testsuites, and answer the students&apos; reports. Their login is a
          pseudonym generated at random, without email. At every import they confirm they have the right to use the material
          the tests are derived from; this is recorded on the server under their pseudonym only. They never see who the
          students are, and students never see who they are.
        </p>
      </div>
      <InviteMaintainer />
      <div className="card card-tight table-wrap">
        <table className="table">
          <thead><tr><th>Pseudonym</th><th>Status</th><th>Created</th><th>Last login</th><th /></tr></thead>
          <tbody>
            {data.maintainers.length === 0 ? <tr><td colSpan={5} className="muted">No maintainer yet.</td></tr> : null}
            {data.maintainers.map((m) => (
              <tr key={m.login}>
                <td className="mono">{m.login}</td>
                <td className={m.active ? 's-pass' : 's-fail'}>{m.active ? 'active' : 'disabled'}</td>
                <td>{formatDate(m.created_at)}</td>
                <td>{formatDate(m.last_login_at)}</td>
                <td style={{ textAlign: 'right' }}><StudentActions login={m.login} active={Boolean(m.active)} back="/admin/maintainers" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pending.length ? (
        <section className="stack">
          <h3>Pending maintainer invitations</h3>
          <div className="card card-tight table-wrap">
            <table className="table">
              <tbody>
                {pending.map((i) => (
                  <tr key={i.id}>
                    <td className="mono">{i.preset_login}</td>
                    <td className="small muted">expires {formatDate(i.expires_at)}</td>
                    <td style={{ textAlign: 'right' }}><RevokeInvitation id={i.id} /></td>
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
