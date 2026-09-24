'use client';

// The invited person chooses their password here and accepts the terms: the account
// is ready immediately, the same login/password work for the dashboard and `git push`.
import { useState, useTransition } from 'react';
import { redeemAction, type RedeemResult } from './actions';

type Preset = { login: string | null; email: string | null };

export function RedeemForm({ token, preset, maintainer }: { token: string; preset: Preset; maintainer: boolean }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<RedeemResult | null>(null);
  const [accepted, setAccepted] = useState(false);

  if (result?.login) {
    return (
      <div className="stack">
        <div className="notice ok">
          Your account <strong className="mono">{result.login}</strong> is ready.
        </div>
        <p className="small muted">
          {maintainer
            ? 'Log in with this login and password: the admin panel opens on the testsuites.'
            : 'Log in with this login and password. You will use the same ones when git push asks for them.'}
        </p>
        <a className="btn btn-primary" href="/login" style={{ alignSelf: 'flex-start' }}>Log in</a>
      </div>
    );
  }

  return (
    <form className="stack" action={(form) => start(async () => setResult(await redeemAction(token, form)))}>
      <label className="field">
        Login
        <input className="input mono" name="login" required readOnly={Boolean(preset.login)} defaultValue={preset.login ?? ''}
          pattern="[A-Za-z0-9][A-Za-z0-9._\-]{1,38}" autoComplete="username" />
      </label>
      {maintainer ? null : (
        <label className="field">
          Email (optional)
          <input className="input" name="email" type="email" readOnly={Boolean(preset.login)} defaultValue={preset.email ?? ''} autoComplete="email" />
        </label>
      )}
      <label className="field">
        Choose a password (8 characters minimum)
        <input className="input" name="password" type="password" required minLength={8} maxLength={128} autoComplete="new-password" />
      </label>
      <label className="field">
        Confirm the password
        <input className="input" name="confirm" type="password" required minLength={8} maxLength={128} autoComplete="new-password" />
      </label>
      <label className="row small" style={{ cursor: 'pointer', alignItems: 'start' }}>
        <input type="checkbox" name="acceptTerms" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
        <span>
          I have read and accept the <a href="/terms" target="_blank">terms of use</a> and the{' '}
          <a href="/privacy" target="_blank">privacy notice</a>.
          {maintainer
            ? ' I will only import tests derived from material I have the right to use.'
            : ' I am responsible for the code I push and for following the rules of my school or course.'}
        </span>
      </label>
      {result?.error ? <div className="notice error">{result.error}</div> : null}
      <div>
        <button type="submit" className="btn btn-primary" disabled={pending || !accepted}>Create my account</button>
      </div>
    </form>
  );
}
