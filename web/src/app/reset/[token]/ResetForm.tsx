'use client';

import { useState, useTransition } from 'react';
import { resetAction, type ResetResult } from './actions';

export function ResetForm({ token }: { token: string }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ResetResult | null>(null);
  if (result?.login) {
    return (
      <div className="stack">
        <div className="notice ok">Your new password is saved.</div>
        <p className="small muted">Use it to log in, and when <code>git push</code> asks for it.</p>
        <a className="btn btn-primary" href="/login" style={{ alignSelf: 'flex-start' }}>Log in</a>
      </div>
    );
  }
  return (
    <form className="stack" action={(form) => start(async () => setResult(await resetAction(token, form)))}>
      <label className="field">
        New password (8 characters minimum)
        <input className="input" name="password" type="password" required minLength={8} maxLength={128} autoComplete="new-password" />
      </label>
      <label className="field">
        Confirm the password
        <input className="input" name="confirm" type="password" required minLength={8} maxLength={128} autoComplete="new-password" />
      </label>
      {result?.error ? <div className="notice error">{result.error}</div> : null}
      <div><button type="submit" className="btn btn-primary" disabled={pending}>Save the new password</button></div>
    </form>
  );
}
