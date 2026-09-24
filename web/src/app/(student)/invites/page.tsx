import { requireUser } from '@/lib/auth';
import { studentApi } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { ErrorState } from '@/components/ErrorState';
import { CreateInvite, RevokeInvite } from './InviteControls';

export const metadata = { title: 'Invitations' };

type Invitation = {
  id: number; created_at: string; expires_at: string; used_at: string | null; used_by: string | null; revoked_at: string | null;
};

function state(inv: Invitation) {
  if (inv.used_at) return { label: `Used by ${inv.used_by}`, tone: 's-pass' };
  if (inv.revoked_at) return { label: 'Revoked', tone: 'faint' };
  if (new Date(inv.expires_at) < new Date()) return { label: 'Expired', tone: 'faint' };
  return { label: 'Pending', tone: 's-warn' };
}

export default async function InvitesPage() {
  const user = await requireUser();
  let data: { accessMode: string; quota: { used: number; limit: number; remaining: number }; invitations: Invitation[] };
  try {
    data = await studentApi(user.login, '/invitations');
  } catch (error) {
    return <ErrorState error={error} />;
  }
  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 'var(--s-2)' }}>
        <h1>Invitations</h1>
        <p className="muted">Access is invitation-only. You are responsible for the people you sponsor.</p>
      </div>
      {data.accessMode === 'sharing' ? (
        <div className="card stack">
          <div className="spread">
            <span className="small muted">
              Invitations used: <strong>{data.quota.used} / {data.quota.limit}</strong>
            </span>
            <span className="small faint">Pending and accepted links count; revoked or expired unused ones do not.</span>
          </div>
          {data.quota.remaining > 0 ? (
            <CreateInvite />
          ) : (
            <div className="notice small">You have reached your sharing limit.</div>
          )}
        </div>
      ) : (
        <div className="notice">Sharing is currently disabled by the administrator: only they can invite new people.</div>
      )}
      {data.invitations.length > 0 ? (
        <div className="card card-tight table-wrap">
          <table className="table">
            <thead><tr><th>#</th><th>Created</th><th>Expires</th><th>Status</th><th /></tr></thead>
            <tbody>
              {data.invitations.map((inv) => {
                const s = state(inv);
                return (
                  <tr key={inv.id}>
                    <td>#{inv.id}</td>
                    <td>{formatDate(inv.created_at)}</td>
                    <td>{formatDate(inv.expires_at)}</td>
                    <td className={s.tone}>{s.label}</td>
                    <td style={{ textAlign: 'right' }}>{s.label === 'Pending' ? <RevokeInvite id={inv.id} /> : null}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
