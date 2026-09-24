'use client';

import { useState } from 'react';
import { signIn, signOut } from 'next-auth/react';
import { IconLogout } from './Icons';

export function LoginForm({ callbackUrl = '/' }: { callbackUrl?: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        setPending(true);
        setError(null);
        const res = await signIn('credentials', {
          login: String(form.get('login') ?? '').trim(),
          password: String(form.get('password') ?? ''),
          redirect: false,
        });
        if (res?.ok) {
          window.location.href = callbackUrl;
          return;
        }
        setError(res?.error && res.error !== 'CredentialsSignin' ? res.error : 'Wrong login or password.');
        setPending(false);
      }}
    >
      <label className="field">
        Login
        <input className="input mono" name="login" required autoComplete="username" autoCapitalize="none" spellCheck={false} />
      </label>
      <label className="field">
        Password
        <input className="input" name="password" type="password" required autoComplete="current-password" />
      </label>
      {error ? <div className="notice error">{error}</div> : null}
      <div>
        <button type="submit" className="btn btn-primary" disabled={pending}>Log in</button>
      </div>
    </form>
  );
}

export function SignOutButton() {
  return (
    <button type="button" className="btn btn-ghost" onClick={() => signOut({ callbackUrl: '/login' })} title="Log out">
      <IconLogout />
      <span className="small">Log out</span>
    </button>
  );
}
