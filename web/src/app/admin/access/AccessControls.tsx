'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { adminFetch } from '@/lib/admin-client';
import { IconShield } from '@/components/Icons';

export function AccessControls({ mode, maxInvites }: { mode: 'closed' | 'sharing'; maxInvites: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(String(maxInvites));

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid-2">
      <section className="card stack">
        <h3 className="row"><IconShield /> Access mode</h3>
        <p className="small muted">
          Never public: there is no open sign-up page in either mode.
        </p>
        <div className="stack" style={{ gap: 'var(--s-2)' }}>
          <div className={`notice ${mode === 'closed' ? 'ok' : ''}`}>
            <strong>Closed</strong>: only you create accounts and invitations.
          </div>
          <div className={`notice ${mode === 'sharing' ? 'ok' : ''}`}>
            <strong>Trusted sharing</strong>: students can sponsor someone with a single-use link (traced below).
          </div>
        </div>
        <div>
          {mode === 'closed' ? (
            <button type="button" className="btn btn-primary" disabled={busy}
              onClick={() => act(() => adminFetch('/access/mode', { body: { mode: 'sharing' } }).then(() => {}))}>
              Enable trusted sharing
            </button>
          ) : (
            <button type="button" className="btn btn-danger" disabled={busy}
              onClick={() => act(() => adminFetch('/access/mode', { body: { mode: 'closed' } }).then(() => {}))}>
              Disable sharing (invalidates pending student invitations)
            </button>
          )}
        </div>
        <hr className="sep" />
        <form
          className="stack"
          style={{ gap: 'var(--s-2)' }}
          onSubmit={(e) => {
            e.preventDefault();
            act(() => adminFetch('/access/max-invites', { body: { value: Number(limit) } }).then(() => {}));
          }}
        >
          <label className="field">
            Sharing limit per student
            <div className="row">
              <input className="input" type="number" min={0} max={100} step={1} value={limit} onChange={(e) => setLimit(e.target.value)} style={{ width: 100 }} />
              <button className="btn" disabled={busy || limit === String(maxInvites)}>Save</button>
            </div>
          </label>
          <p className="small faint">
            Pending and accepted invitations count. Lowering the limit revokes nothing: people already invited keep
            their access and existing links stay valid; students over the limit just cannot create new ones.
          </p>
        </form>
      </section>
      <section className="card stack">
        <h3>Inviting people</h3>
        <p className="small muted">
          All invitations are created in <Link href="/admin/students">Students</Link>: a personal link (login and email
          fixed), a whole class from a CSV, or an open link. This page sets the rules and shows who invited whom and
          every invitation, which you can revoke below.
        </p>
        <div><Link href="/admin/students" className="btn btn-primary">Invite someone</Link></div>
        {error ? <div className="notice error">{error}</div> : null}
      </section>
    </div>
  );
}

export function RevokeInvitation({ id }: { id: number }) {
  const router = useRouter();
  return (
    <button type="button" className="btn btn-danger"
      onClick={async () => {
        await adminFetch(`/access/invitations/${id}`, { method: 'DELETE' }).catch(() => {});
        router.refresh();
      }}>
      Revoke
    </button>
  );
}
