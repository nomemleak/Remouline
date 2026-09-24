'use client';

import { useState, useTransition } from 'react';
import { createInviteAction, revokeInviteAction } from './actions';
import { CommandBox } from '@/components/CopyButton';
import { IconPlus } from '@/components/Icons';

export function CreateInvite() {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ url?: string; expiresAt?: string; error?: string } | null>(null);
  return (
    <div className="stack">
      <div>
        <button type="button" className="btn btn-primary" disabled={pending} onClick={() => start(async () => setResult(await createInviteAction()))}>
          <IconPlus /> Create an invitation link
        </button>
      </div>
      {result?.error ? <div className="notice error">{result.error}</div> : null}
      {result?.url ? (
        <div className="stack" style={{ gap: 'var(--s-2)' }}>
          <p className="small muted">
            Send this single-use link to the person you sponsor. It is shown only once and expires on{' '}
            {new Date(result.expiresAt!).toLocaleString('en-GB')}.
          </p>
          <CommandBox command={result.url} />
        </div>
      ) : null}
    </div>
  );
}

export function RevokeInvite({ id }: { id: number }) {
  const [pending, start] = useTransition();
  return (
    <button type="button" className="btn btn-danger" disabled={pending} onClick={() => start(() => revokeInviteAction(id))}>
      Revoke
    </button>
  );
}
