'use client';

// The ONE place to invite students. With a login (email optional): personal link,
// both fixed. Without: open link (the person chooses them). The person always chooses their own
// password on the link: you never handle passwords.
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { adminFetch } from '@/lib/admin-client';
import { CopyButton } from '@/components/CopyButton';

type Invitation = { login: string | null; email: string | null; open?: boolean; token?: string; expiresAt?: string; error?: string };

export function CreateStudents() {
  const router = useRouter();
  const [csv, setCsv] = useState('');
  const [ttlDays, setTtlDays] = useState('14');
  const [invitations, setInvitations] = useState<Invitation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (path: string, body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await adminFetch<{ invitations: Invitation[] }>(path, { body: { ...body, ttlDays: Number(ttlDays) } });
      setInvitations(res.invitations);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const link = (i: Invitation) => `${window.location.origin}/invite/${i.token}`;
  const created = (invitations ?? []).filter((i) => i.token);
  const asCsv = ['login,email,link', ...created.map((i) => `${i.login ?? ''},${i.email ?? ''},${link(i)}`)].join('\n');
  const line = (i: Invitation) =>
    i.error ? `${i.login ?? 'open link'}: NOT CREATED (${i.error})` : `${i.open ? '(open link)' : i.login}  ${link(i)}`;

  return (
    <div className="stack">
      <h2>Invite</h2>
      <div className="grid-2">
        <form
          className="card stack"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            submit('/students', {
              login: String(f.get('login') ?? '').trim(),
              email: String(f.get('email') ?? '').trim(),
              note: String(f.get('note') ?? '').trim(),
            });
          }}
        >
          <h3>One person</h3>
          <p className="small muted">
            Fill a login (the email is optional) for a <strong>personal link</strong>. Leave both empty for an{' '}
            <strong>open link</strong> where the person chooses them (e.g. someone whose login you do not know).
          </p>
          <label className="field">Login<input className="input mono" name="login" /></label>
          <label className="field">Email (optional)<input className="input" name="email" type="email" /></label>
          <label className="field">Note, for you (optional)<input className="input" name="note" placeholder="who is it for?" /></label>
          <div><button className="btn btn-primary" disabled={busy}>Create invitation link</button></div>
        </form>
        <div className="card stack">
          <h3>A whole class (CSV)</h3>
          <p className="small muted">One <code>login</code> or <code>login,email</code> per line (a header line is ignored): one personal link each.</p>
          <textarea className="textarea" value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={'login,email\njohn.doe,john.doe@example.com'} />
          <div><button type="button" className="btn btn-primary" disabled={busy || !csv.trim()} onClick={() => submit('/students/bulk', { csv })}>Create personal links</button></div>
        </div>
      </div>
      <label className="row small muted">
        Links valid for
        <input className="input" type="number" min={1} max={60} value={ttlDays} onChange={(e) => setTtlDays(e.target.value)} style={{ width: 80 }} />
        days · single use · listed and revocable in <a href="/admin/access">Access</a>
      </label>
      {error ? <div className="notice error">{error}</div> : null}
      {invitations ? (
        <div className="card stack">
          <div className="spread">
            <h3>Invitation links (shown only once)</h3>
            {created.length ? <CopyButton text={created.length === 1 ? link(created[0]) : asCsv} label={created.length === 1 ? 'Copy link' : 'Copy as CSV'} /> : null}
          </div>
          <p className="small muted">
            Send each link privately. The person chooses their password on it, then the link stops working. A new personal
            link for the same login cancels the previous one.
          </p>
          <pre className="codeblock">{invitations.map(line).join('\n')}</pre>
        </div>
      ) : null}
    </div>
  );
}
