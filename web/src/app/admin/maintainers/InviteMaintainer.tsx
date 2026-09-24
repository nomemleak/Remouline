'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { adminFetch } from '@/lib/admin-client';
import { CopyButton } from '@/components/CopyButton';
import { IconPlus } from '@/components/Icons';

export function InviteMaintainer() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ login: string; link: string } | null>(null);
  return (
    <section className="card stack">
      <div className="spread">
        <h3>Invite a maintainer</h3>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const res = await adminFetch<{ login: string; token: string }>('/maintainers', { body: {} });
              setCreated({ login: res.login, link: `${window.location.origin}/invite/${res.token}` });
              router.refresh();
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <IconPlus /> New maintainer link
        </button>
      </div>
      <p className="small muted">
        Single-use link valid 7 days, with a generated pseudonym. Send it privately; the person chooses their password on it.
      </p>
      {error ? <div className="notice error">{error}</div> : null}
      {created ? (
        <div className="notice stack" style={{ gap: 'var(--s-1)' }}>
          <span className="small">Pseudonym <strong className="mono">{created.login}</strong> · link shown only once:</span>
          <span className="mono small" style={{ overflowWrap: 'anywhere' }}>{created.link}</span>
          <div><CopyButton text={created.link} label="Copy link" /></div>
        </div>
      ) : null}
    </section>
  );
}
