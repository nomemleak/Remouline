'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { adminFetch } from '@/lib/admin-client';
import { IconPlus } from '@/components/Icons';

export function NewAssignmentForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="card stack"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        const slug = String(form.get('slug')).trim();
        setBusy(true);
        setError(null);
        try {
          await adminFetch('/assignments', { body: { slug, title: String(form.get('title')).trim() } });
          router.push(`/admin/assignments/${encodeURIComponent(slug)}/tests`);
        } catch (err) {
          setError((err as Error).message);
          setBusy(false);
        }
      }}
    >
      <h3>New assignment</h3>
      <p className="small muted">
        The slug must be <strong>exactly</strong> the name of the assignment folder found at the root of the students&apos;
        repositories (e.g. <code>SpaceMission</code>): it is how each push is routed to its testsuite.
      </p>
      <div className="grid-2">
        <label className="field">Slug (assignment folder)<input className="input mono" name="slug" required placeholder="SpaceMission" /></label>
        <label className="field">Display title<input className="input" name="title" placeholder="Week 3 · Space mission" /></label>
      </div>
      {error ? <div className="notice error">{error}</div> : null}
      <div><button className="btn btn-primary" disabled={busy}><IconPlus /> Create and import tests</button></div>
    </form>
  );
}
