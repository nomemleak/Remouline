'use client';

// Change password, export all my data, delete my account (immediate, repositories included).
import { useState, useTransition } from 'react';
import { signOut } from 'next-auth/react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { changePasswordAction, deleteAccountAction } from './actions';

export function AccountControls({ login, operator }: { login: string; operator: boolean }) {
  const [pending, start] = useTransition();
  const [passwordResult, setPasswordResult] = useState<{ ok?: boolean; error?: string } | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);

  return (
    <>
      <section className="card stack">
        <h3>Change my password</h3>
        <p className="small muted">The same password is used for this dashboard and for <code>git push</code>.</p>
        <form
          className="stack"
          action={(form) => start(async () => {
            setPasswordResult(await changePasswordAction(form));
          })}
        >
          <label className="field">
            Current password
            <input className="input" name="current" type="password" required autoComplete="current-password" />
          </label>
          <div className="grid-2">
            <label className="field">
              New password (8 characters minimum)
              <input className="input" name="next" type="password" required minLength={8} maxLength={128} autoComplete="new-password" />
            </label>
            <label className="field">
              Confirm the new password
              <input className="input" name="confirm" type="password" required minLength={8} maxLength={128} autoComplete="new-password" />
            </label>
          </div>
          {passwordResult?.ok ? <div className="notice ok">Password changed.</div> : null}
          {passwordResult?.error ? <div className="notice error">{passwordResult.error}</div> : null}
          <div><button type="submit" className="btn" disabled={pending}>Change password</button></div>
        </form>
      </section>

      <section className="card stack">
        <h3>Export my data</h3>
        <p className="small muted">
          One JSON file with your account, every push and its results, your reports and votes. Your code itself is in your
          own repositories.
        </p>
        <div><a className="btn" href="/account/export" download>Download my data</a></div>
      </section>

      <section className="card stack">
        <h3>Delete my account</h3>
        {operator ? (
          <p className="small muted">Operator accounts are removed from <code>OPERATOR_LOGINS</code> on the server first.</p>
        ) : (
          <>
            <p className="small muted">
              Deletes your account, your repositories on this server, all your results, reports and votes, immediately. It
              cannot be undone.
            </p>
            <div><button type="button" className="btn btn-danger" onClick={() => setDeleteOpen(true)}>Delete my account…</button></div>
          </>
        )}
      </section>

      <ConfirmDialog
        open={deleteOpen}
        danger
        busy={pending}
        title="Delete your account?"
        confirmLabel="Delete everything"
        confirmText={login}
        confirmDisabled={!password}
        error={deleteError}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => start(async () => {
          const res = await deleteAccountAction(login, password);
          if (res.error) {
            setDeleteError(res.error);
            return;
          }
          await signOut({ callbackUrl: '/login' });
        })}
      >
        <p>Everything is deleted right away, including your repositories on this server. Export your data first if you want to keep it.</p>
        <label className="field">
          Password
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </label>
      </ConfirmDialog>
    </>
  );
}
