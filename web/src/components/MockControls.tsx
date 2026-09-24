'use client';

// UI of the local mock mode (never rendered in production: guarded by MOCK_MODE on the server).
import { useTransition } from 'react';
import { mockSignIn, mockSignOut } from '@/lib/mock/actions';
import type { MockUser } from '@/lib/mock/mode';
import { IconLogout } from './Icons';

const USERS: { key: MockUser; label: string }[] = [
  { key: 'student', label: 'Student (mock.student)' },
  { key: 'other', label: 'Other student (mock.other)' },
  { key: 'maintainer', label: 'Maintainer (m-demo42)' },
  { key: 'operator', label: 'Operator (operator)' },
];

export function MockLogin() {
  const [pending, start] = useTransition();
  return (
    <div className="stack" style={{ gap: 'var(--s-2)' }}>
      <div className="notice small">Local mock mode: no Git server, fake data. Pick a user.</div>
      {USERS.map((u) => (
        <button key={u.key} type="button" className="btn" disabled={pending} onClick={() => start(() => mockSignIn(u.key))}>
          {u.label}
        </button>
      ))}
    </div>
  );
}

export function MockBar({ current }: { current: string }) {
  const [pending, start] = useTransition();
  return (
    <div
      className="small"
      style={{
        background: 'var(--c-warn-muted)', color: 'var(--c-warn)', borderBottom: '1px solid var(--c-border)',
        padding: 'var(--s-1) var(--s-5)', display: 'flex', gap: 'var(--s-3)', alignItems: 'center', flexWrap: 'wrap',
      }}
    >
      <strong>MOCK MODE</strong>
      <span>fake data, local only · logged in as {current} · switch to:</span>
      {USERS.map((u) => (
        <button key={u.key} type="button" className="btn btn-ghost" style={{ height: 24 }} disabled={pending} onClick={() => start(() => mockSignIn(u.key))}>
          {u.key}
        </button>
      ))}
    </div>
  );
}

export function MockSignOutButton() {
  const [pending, start] = useTransition();
  return (
    <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => start(() => mockSignOut())}>
      <IconLogout />
      <span className="small">Log out</span>
    </button>
  );
}
