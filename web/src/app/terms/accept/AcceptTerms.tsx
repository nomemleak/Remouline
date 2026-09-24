'use client';

import { useState, useTransition } from 'react';
import { acceptTermsAction } from './actions';

export function AcceptTerms() {
  const [checked, setChecked] = useState(false);
  const [pending, start] = useTransition();
  return (
    <div className="card stack">
      <label className="row small" style={{ cursor: 'pointer', alignItems: 'start' }}>
        <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
        <span>I have read and accept the terms of use and the <a href="/privacy" target="_blank">privacy notice</a>.</span>
      </label>
      <div>
        <button type="button" className="btn btn-primary" disabled={!checked || pending} onClick={() => start(() => acceptTermsAction())}>
          Continue
        </button>
      </div>
    </div>
  );
}
