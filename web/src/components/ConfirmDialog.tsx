'use client';

// Modal confirmation for irreversible actions. With `confirmText`, the user must type
// it exactly before the confirm button is enabled.
import { useEffect, useRef, useState } from 'react';
import { IconAlert } from './Icons';

type Props = {
  open: boolean;
  title: string;
  children: React.ReactNode;
  confirmLabel: string;
  confirmText?: string;
  danger?: boolean;
  busy?: boolean;
  error?: string | null;
  /** Extra condition, e.g. a password field left empty. */
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

export function ConfirmDialog({ open, title, children, confirmLabel, confirmText, danger, busy, error, confirmDisabled, onConfirm, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [typed, setTyped] = useState('');

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setTyped('');
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const allowed = !busy && !confirmDisabled && (!confirmText || typed === confirmText);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        if (busy) e.preventDefault();
      }}
      style={{
        background: 'var(--c-surface)', color: 'var(--c-text)', border: '1px solid var(--c-border-strong)',
        borderRadius: 'var(--r-lg)', padding: 'var(--s-5)', width: 'min(480px, calc(100vw - 32px))',
      }}
    >
      <form
        method="dialog"
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (allowed) onConfirm();
        }}
      >
        <h3 className={`row ${danger ? 's-fail' : ''}`}><IconAlert /> {title}</h3>
        <div className="small muted stack" style={{ gap: 'var(--s-2)' }}>{children}</div>
        {confirmText ? (
          <label className="field">
            Type <strong className="mono" style={{ color: 'var(--c-text)' }}>{confirmText}</strong> to confirm
            <input className="input mono" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus autoComplete="off" />
          </label>
        ) : null}
        {error ? <div className="notice error">{error}</div> : null}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="submit" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} disabled={!allowed}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}
