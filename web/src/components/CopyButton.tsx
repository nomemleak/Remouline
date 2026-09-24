'use client';

import { useState } from 'react';
import { IconCheck, IconCopy } from './Icons';

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <IconCheck /> : <IconCopy />}
      {copied ? 'Copied' : label}
    </button>
  );
}

export function CommandBox({ command }: { command: string }) {
  return (
    <div className="stack" style={{ gap: 'var(--s-2)' }}>
      <pre className="codeblock wrap" style={{ userSelect: 'all' }}>{command}</pre>
      <div>
        <CopyButton text={command} label="Copy command" />
      </div>
    </div>
  );
}
