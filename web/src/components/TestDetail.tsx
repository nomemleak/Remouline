'use client';

// Failing-test view: error message, expected vs actual (with a line diff and a hex
// view for binary content), memory check result, and the raw "Failures" panel that
// shows sanitizer / valgrind / compiler output exactly as produced.
import { useState } from 'react';
import type { TestResult } from '@/lib/types';
import { LEAF_LABELS, formatDuration, leafTone } from '@/lib/format';
import { escapeForDisplay, hasBinaryContent, hexDump } from '@/lib/escape';
import { lineDiff, showWhitespace } from '@/lib/diff';
import { IconAlert, IconCheck, IconCross, IconDash } from './Icons';
import { TONE_ICON } from './StatusBadge';
import { TestReports, type ReportingContext } from './Reports';
import styles from './TestDetail.module.css';

function OutputField({ label, value }: { label: string; value: string | null }) {
  const binary = hasBinaryContent(value);
  const [hex, setHex] = useState(false);
  return (
    <div className="stack" style={{ gap: 'var(--s-2)', minWidth: 0 }}>
      <div className="spread">
        <span className="caption">{label}</span>
        {binary ? (
          <button type="button" className="btn btn-ghost" onClick={() => setHex(!hex)}>
            {hex ? 'Text view' : 'Hex view'}
          </button>
        ) : null}
      </div>
      {value == null ? (
        <pre className="codeblock faint">(not available)</pre>
      ) : (
        <pre className="codeblock">{hex ? hexDump(value) : escapeForDisplay(value)}</pre>
      )}
    </div>
  );
}

function Diff({ expected, actual }: { expected: string; actual: string }) {
  const lines = lineDiff(escapeForDisplay(expected), escapeForDisplay(actual));
  return (
    <div className="stack" style={{ gap: 'var(--s-2)' }}>
      <span className="caption">Diff</span>
      <pre className={`codeblock ${styles.diff}`}>
        {lines.map((line, i) => (
          <div key={i} className={styles[line.kind]}>
            <span className={styles.sign}>{line.kind === 'same' ? ' ' : line.kind === 'expected' ? '-' : '+'}</span>
            {showWhitespace(line.text) || ' '}
          </div>
        ))}
      </pre>
      <span className="small faint">
        <span className="s-pass">- expected</span> · <span className="s-fail">+ actual</span> · trailing spaces shown as ·
      </span>
    </div>
  );
}

// valgrind_ok / valgrind_details hold the memory check: LeakSanitizer, or valgrind for programs.
function MemoryCheck({ result }: { result: TestResult }) {
  if (result.valgrind_ok === 1) {
    return (
      <div className="row small s-pass">
        <IconCheck /> Memory check: no leak or memory error detected in your code.
      </div>
    );
  }
  if (result.valgrind_ok === 0) {
    return (
      <div className="stack" style={{ gap: 'var(--s-2)' }}>
        <div className="row small s-fail">
          <IconCross /> The memory check found leaks or memory errors in your code:
        </div>
        <pre className="codeblock">{escapeForDisplay(result.valgrind_details)}</pre>
      </div>
    );
  }
  return (
    <div className="row small faint">
      <IconDash /> Memory check: {result.valgrind_details ? escapeForDisplay(result.valgrind_details) : 'not run (only passing tests are checked).'}
    </div>
  );
}

export function TestDetail({ result, reporting }: { result: TestResult; reporting?: ReportingContext }) {
  const tone = leafTone(result.status, result.valgrind_ok);
  const Icon = TONE_ICON[tone];
  const showIo = result.expected_output != null || result.actual_output != null;
  const isFailure = tone !== 'pass';
  const isTest = result.category_path.startsWith('Testsuite');

  return (
    <div className="stack">
      <div className="card stack" style={{ gap: 'var(--s-3)' }}>
        <div className="spread">
          <div className="stack" style={{ gap: 'var(--s-1)', minWidth: 0 }}>
            <span className="small faint mono" style={{ overflowWrap: 'anywhere' }}>{result.category_path}</span>
            <h3 className="mono" style={{ overflowWrap: 'anywhere' }}>{result.test_name}</h3>
          </div>
          <div className="row">
            <span className={`badge s-${tone}`}>
              <Icon size={12} /> {LEAF_LABELS[result.status]}
            </span>
            {result.duration_ms != null ? <span className="small faint">{formatDuration(result.duration_ms)}</span> : null}
          </div>
        </div>

        {result.error_message ? (
          <div className="stack" style={{ gap: 'var(--s-2)' }}>
            <span className="caption">Message</span>
            <pre className="codeblock wrap">{escapeForDisplay(result.error_message)}</pre>
          </div>
        ) : null}

        {showIo ? (
          <>
            <div className="grid-2">
              <OutputField label="Expected" value={result.expected_output} />
              <OutputField label="Actual" value={result.actual_output} />
            </div>
            {result.expected_output != null && result.actual_output != null ? (
              <Diff expected={result.expected_output} actual={result.actual_output} />
            ) : null}
          </>
        ) : null}

        {isTest ? <MemoryCheck result={result} /> : null}
        {isTest && reporting ? (
          <>
            <hr className="sep" />
            <TestReports ctx={reporting} resultId={result.id} categoryPath={result.category_path} testName={result.test_name} />
          </>
        ) : null}
      </div>

      {result.raw_output ? (
        <section className={`card ${styles.failures}`}>
          <h2 className="row">
            <IconAlert size={20} />
            {isFailure ? 'Failures' : 'Output'}
          </h2>
          <hr className="sep" />
          <pre className={`codeblock ${styles.raw}`}>{escapeForDisplay(result.raw_output)}</pre>
        </section>
      ) : null}
    </div>
  );
}
