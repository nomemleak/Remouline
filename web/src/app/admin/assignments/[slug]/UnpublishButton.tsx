'use client';

// Takedown: closes the assignment to students immediately (tests are kept, a
// maintainer can publish it again). Deleting it removes everything.
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { adminFetch } from '@/lib/admin-client';
import { ConfirmDialog } from '@/components/ConfirmDialog';

export function UnpublishButton({ slug }: { slug: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}>Unpublish</button>
      <ConfirmDialog
        open={open}
        title="Unpublish this assignment?"
        confirmLabel="Unpublish"
        busy={busy}
        error={error}
        onClose={() => setOpen(false)}
        onConfirm={async () => {
          setBusy(true);
          setError(null);
          try {
            await adminFetch(`/assignments/${encodeURIComponent(slug)}/unpublish`, { method: 'POST' });
            setOpen(false);
            router.refresh();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <p>Students can no longer test this assignment: new pushes are reported as not configured. The testsuite is kept.</p>
      </ConfirmDialog>
    </>
  );
}
