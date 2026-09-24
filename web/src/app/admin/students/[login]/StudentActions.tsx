'use client';

// Operator actions on one account: enable/disable, password reset link, deletion.
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { adminFetch } from '@/lib/admin-client';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { CopyButton } from '@/components/CopyButton';

export function StudentActions({ login, active, back = '/admin/students' }: { login: string; active: boolean; back?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetLink, setResetLink] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const path = `/students/${encodeURIComponent(login)}`;

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack" style={{ alignItems: 'flex-end', gap: 'var(--s-2)' }}>
      <div className="row">
        <button type="button" className="btn" disabled={busy}
          onClick={() => act(async () => {
            const res = await adminFetch<{ token: string }>(`${path}/reset-link`, { method: 'POST' });
            setResetLink(`${window.location.origin}/reset/${res.token}`);
          })}>
          Password reset link
        </button>
        <button type="button" className={`btn ${active ? 'btn-danger' : 'btn-primary'}`} disabled={busy}
          onClick={() => act(async () => {
            if (active && !confirm(`Disable ${login}? They will no longer be able to log in or push.`)) return;
            await adminFetch(`${path}/active`, { body: { active: !active } });
            router.refresh();
          })}>
          {active ? 'Disable account' : 'Enable account'}
        </button>
        <button type="button" className="btn btn-danger" disabled={busy} onClick={() => setDeleteOpen(true)}>Delete…</button>
      </div>
      {resetLink ? (
        <div className="notice small stack" style={{ gap: 'var(--s-1)' }}>
          <span>Single-use link, valid 72 hours (shown only once). Send it privately:</span>
          <span className="mono" style={{ overflowWrap: 'anywhere' }}>{resetLink}</span>
          <div><CopyButton text={resetLink} label="Copy link" /></div>
        </div>
      ) : null}
      {error && !deleteOpen ? <span className="small s-fail">{error}</span> : null}
      <ConfirmDialog
        open={deleteOpen}
        danger
        busy={busy}
        error={error}
        title={`Delete ${login}?`}
        confirmLabel="Delete permanently"
        confirmText={login}
        onClose={() => !busy && setDeleteOpen(false)}
        onConfirm={() => act(async () => {
          await adminFetch(`${path}/delete`, { body: { confirm: login } });
          setDeleteOpen(false);
          router.push(back);
          router.refresh();
        })}
      >
        <p>Deletes the account, its Git repositories, pushes, results, reports and votes. It cannot be undone.</p>
      </ConfirmDialog>
    </div>
  );
}
