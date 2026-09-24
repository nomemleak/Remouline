'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { adminFetch } from '@/lib/admin-client';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { IconAlert } from '@/components/Icons';

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await fn();
      setDone(message);
      router.refresh();
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, done, run };
}

/** Emergency pause: pushes are no longer graded, invitations stop working, every page shows the message. */
export function PauseSwitch({ paused, message }: { paused: boolean; message: string }) {
  const { busy, error, run } = useAction();
  const [text, setText] = useState(message);
  const [open, setOpen] = useState(false);
  return (
    <section className={`card stack ${paused ? 'notice error' : ''}`}>
      <h3 className="row"><IconAlert /> Emergency pause</h3>
      <p className="small muted">
        {paused
          ? 'The service is PAUSED: pushes are not graded (queued ones wait), invitation links cannot be used, and every page shows the message below. Logins, results, exports and account deletion still work.'
          : 'Stops the service at once, e.g. while you answer a removal request: pushes are no longer graded, invitation links stop working, and every page shows your message.'}
      </p>
      <label className="field">
        Message shown to users
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} maxLength={500} placeholder="The service is paused. Pushes are not graded for now." />
      </label>
      {error ? <div className="notice error">{error}</div> : null}
      <div className="row">
        {paused ? (
          <>
            <button type="button" className="btn btn-primary" disabled={busy}
              onClick={() => run(() => adminFetch('/settings/service', { body: { paused: false, message: '' } }), 'Resumed.')}>
              Resume the service
            </button>
            <button type="button" className="btn" disabled={busy}
              onClick={() => run(() => adminFetch('/settings/service', { body: { paused: true, message: text } }), 'Message updated.')}>
              Update the message
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-danger" disabled={busy} onClick={() => setOpen(true)}>Pause the service…</button>
        )}
      </div>
      <ConfirmDialog
        open={open}
        danger
        busy={busy}
        title="Pause the service?"
        confirmLabel="Pause now"
        onClose={() => setOpen(false)}
        onConfirm={async () => {
          if (await run(() => adminFetch('/settings/service', { body: { paused: true, message: text } }), 'Paused.')) setOpen(false);
        }}
      >
        <p>New pushes are no longer graded and invitation links stop working until you resume.</p>
      </ConfirmDialog>
    </section>
  );
}

export function ContactForm({ contact }: { contact: string }) {
  const { busy, error, done, run } = useAction();
  const [value, setValue] = useState(contact);
  return (
    <section className="card stack">
      <h3>Contact</h3>
      <p className="small muted">
        Shown in the terms of use, privacy and legal notices (<code>{'{{CONTACT}}'}</code>): where users and rights holders
        write, e.g. for a removal request. A dedicated address is best.
      </p>
      <div className="row">
        <input className="input" style={{ flex: 1, minWidth: 220 }} value={value} onChange={(e) => setValue(e.target.value)} placeholder="contact@example.com" />
        <button type="button" className="btn" disabled={busy || value === contact}
          onClick={() => run(() => adminFetch('/settings/contact', { body: { contact: value } }), 'Saved.')}>
          Save
        </button>
      </div>
      {error ? <div className="notice error">{error}</div> : null}
      {done ? <div className="small s-pass">{done}</div> : null}
    </section>
  );
}

export function PageEditor({ name, title, text }: { name: 'terms' | 'privacy' | 'legal'; title: string; text: string }) {
  const { busy, error, done, run } = useAction();
  const [value, setValue] = useState(text);
  const path = `/settings/pages/${name}`;
  return (
    <details className="card stack">
      <summary style={{ cursor: 'pointer' }}><strong>{title}</strong> <a href={`/${name}`} target="_blank" className="small">view</a></summary>
      <textarea className="textarea mono" style={{ minHeight: 360, marginTop: 'var(--s-3)' }} value={value} onChange={(e) => setValue(e.target.value)} />
      {error ? <div className="notice error">{error}</div> : null}
      {done ? <div className="small s-pass">{done}</div> : null}
      <div className="row">
        <button type="button" className="btn btn-primary" disabled={busy || value === text}
          onClick={() => run(() => adminFetch(path, { method: 'PUT', body: { text: value } }), name === 'terms' ? 'Saved: users will accept the new version at their next visit.' : 'Saved.')}>
          Save
        </button>
        <button type="button" className="btn btn-ghost" disabled={busy}
          onClick={async () => {
            if (!confirm(`Restore the default ${title.toLowerCase()}?`)) return;
            await run(async () => {
              const res = await adminFetch<{ text: string }>(path, { method: 'PUT', body: { reset: true } });
              setValue(res.text);
            }, 'Default restored.');
          }}>
          Restore default
        </button>
      </div>
    </details>
  );
}
