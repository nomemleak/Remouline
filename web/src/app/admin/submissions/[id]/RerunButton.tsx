'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { adminFetch } from '@/lib/admin-client';
import { IconRefresh } from '@/components/Icons';

export function RerunButton({ id, disabled }: { id: number; disabled: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        className="btn"
        disabled={disabled || busy}
        title="Grade the same commit again, without the student pushing"
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await adminFetch(`/submissions/${id}/rerun`, { method: 'POST' });
            router.refresh();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <IconRefresh /> Re-run
      </button>
      {error ? <span className="small s-fail">{error}</span> : null}
    </>
  );
}
