import Link from 'next/link';
import { requireStaff } from '@/lib/auth';
import { adminApi } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { ErrorState } from '@/components/ErrorState';
import { AccessControls, RevokeInvitation } from './AccessControls';

export const metadata = { title: 'Access' };

type Access = {
  accessMode: 'closed' | 'sharing';
  maxInvitesPerStudent: number;
  invitations: {
    id: number; created_by: string; created_by_admin: number; note: string | null; created_at: string;
    expires_at: string; used_at: string | null; used_by: string | null; revoked_at: string | null;
    preset_login?: string | null;
  }[];
  tree: { login: string; invited_by: string | null; active: number; created_via: string; created_at: string; shares: number }[];
};

type TreeRow = Access['tree'][number];

function InviteTree({ rows, limit }: { rows: TreeRow[]; limit: number }) {
  const children = new Map<string | null, TreeRow[]>();
  const logins = new Set(rows.map((r) => r.login));
  for (const r of rows) {
    const parent = r.invited_by && logins.has(r.invited_by) ? r.invited_by : null;
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent)!.push(r);
  }
  const render = (parent: string | null, depth: number): React.ReactNode =>
    (children.get(parent) ?? []).map((r) => (
      <div key={r.login}>
        <div className="small" style={{ paddingLeft: depth * 20 }}>
          {depth > 0 ? <span className="faint">└ </span> : null}
          <Link href={`/admin/students/${encodeURIComponent(r.login)}`} className="mono">{r.login}</Link>
          <span className="faint"> · {r.created_via}{r.invited_by && !logins.has(r.invited_by) ? ` by ${r.invited_by}` : ''}</span>
          {r.active ? null : <span className="s-fail"> · disabled</span>}
          {r.shares > 0 ? (
            <span className={r.shares > limit ? 's-warn' : 'faint'} title="Shares used (pending + accepted) / current limit">
              {' '}· {r.shares}/{limit} shares{r.shares > limit ? ' (over the new limit, kept)' : ''}
            </span>
          ) : null}
        </div>
        {render(r.login, depth + 1)}
      </div>
    ));
  return <div className="stack" style={{ gap: 2 }}>{render(null, 0)}</div>;
}

function invitationState(i: Access['invitations'][number]) {
  if (i.used_at) return `used by ${i.used_by} (${formatDate(i.used_at)})`;
  if (i.revoked_at) return 'revoked';
  if (new Date(i.expires_at) < new Date()) return 'expired';
  return 'pending';
}

export default async function AccessPage() {
  const admin = await requireStaff('operator');
  let data: Access;
  try {
    data = await adminApi<Access>(admin.login, '/access');
  } catch (error) {
    return <ErrorState error={error} />;
  }
  return (
    <div className="stack-lg">
      <h1>Access</h1>
      <AccessControls mode={data.accessMode} maxInvites={data.maxInvitesPerStudent} />
      <div className="grid-2">
        <section className="card stack">
          <h3>Who invited whom</h3>
          <InviteTree rows={data.tree} limit={data.maxInvitesPerStudent} />
        </section>
        <section className="card stack">
          <h3>Invitations</h3>
          <div className="table-wrap">
            <table className="table">
              <tbody>
                {data.invitations.length === 0 ? <tr><td className="muted">No invitation.</td></tr> : null}
                {data.invitations.map((i) => {
                  const state = invitationState(i);
                  return (
                    <tr key={i.id}>
                      <td>#{i.id}</td>
                      <td className="mono small">{i.created_by}{i.created_by_admin ? ' (operator)' : ''}</td>
                      <td className="small muted">{state}</td>
                      <td className="small faint">{i.preset_login ? <>personal link for <span className="mono">{i.preset_login}</span></> : i.note}</td>
                      <td style={{ textAlign: 'right' }}>{state === 'pending' ? <RevokeInvitation id={i.id} /> : null}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
