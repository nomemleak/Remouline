'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { adminFetch } from '@/lib/admin-client';
import { ConfirmDialog } from '@/components/ConfirmDialog';

export function DeleteAssignment({ slug }: { slug: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <button type="button" className="btn btn-danger" onClick={() => { setError(null); setOpen(true); }}>
        Delete
      </button>
      <ConfirmDialog
        open={open}
        danger
        busy={busy}
        error={error}
        title={`Delete ${slug}?`}
        confirmLabel="Delete permanently"
        confirmText={slug}
        onClose={() => !busy && setOpen(false)}
        onConfirm={async () => {
          setBusy(true);
          setError(null);
          try {
            await adminFetch(`/assignments/${encodeURIComponent(slug)}/delete`, { body: { confirm: slug } });
            router.push('/admin');
            router.refresh();
          } catch (err) {
            setError((err as Error).message);
            setBusy(false);
          }
        }}
      >
        <p>This cannot be undone. It permanently deletes:</p>
        <ul style={{ margin: 0, paddingLeft: 'var(--s-5)' }}>
          <li>the assignment, its tests and headers (draft and published);</li>
          <li>every student submission and result on it;</li>
          <li>its reports and votes.</li>
        </ul>
        <p>Students&apos; Git repositories are not touched. To only hide it from students, use <em>Unpublish</em> instead.</p>
      </ConfirmDialog>
    </>
  );
}
