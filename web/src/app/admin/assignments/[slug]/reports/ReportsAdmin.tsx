'use client';

// Students' reports on one assignment: votes, evidence, answer and resolve/reject, and
// a neutral JSON export. Reports are anonymous: nobody sees who posted or voted.
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { adminFetch, downloadJson } from '@/lib/admin-client';
import { formatDate } from '@/lib/format';
import { escapeForDisplay } from '@/lib/escape';

export type AdminReport = {
  id: number; category_path: string; test_name: string; message: string; status: string;
  agree: number; disagree: number; created_at: string; closed_at: string | null; admin_note: string | null;
  evidence: { status?: string; error_message?: string | null; expected_output?: string | null; actual_output?: string | null } | null;
};

const STATUS_TONE: Record<string, string> = { open: 's-warn', resolved: 's-pass', rejected: 'faint' };

function ReportCard({ report }: { report: AdminReport }) {
  const router = useRouter();
  const [note, setNote] = useState(report.admin_note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setStatus = async (status: string) => {
    setBusy(true);
    setError(null);
    try {
      await adminFetch(`/reports/${report.id}/status`, { body: { status, note } });
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card card-tight stack" style={{ gap: 'var(--s-2)' }}>
      <div className="spread">
        <span className="mono small" style={{ overflowWrap: 'anywhere' }}>{report.category_path}/<strong>{report.test_name}</strong></span>
        <div className="row small">
          <span className="s-pass">{report.agree} agree</span>
          <span className="s-fail">{report.disagree} disagree</span>
          <span className={`badge ${STATUS_TONE[report.status] ?? ''}`}>{report.status}</span>
        </div>
      </div>
      <p className="small">{escapeForDisplay(report.message)}</p>
      <span className="small faint">#{report.id} · {formatDate(report.created_at)}</span>
      {report.evidence?.error_message ? (
        <details>
          <summary className="small muted" style={{ cursor: 'pointer' }}>What the student got</summary>
          <pre className="codeblock wrap" style={{ marginTop: 'var(--s-2)' }}>
            {escapeForDisplay(report.evidence.error_message)}
            {report.evidence.expected_output != null ? `\n\nExpected: ${escapeForDisplay(report.evidence.expected_output)}` : ''}
            {report.evidence.actual_output != null ? `\nActual:   ${escapeForDisplay(report.evidence.actual_output)}` : ''}
          </pre>
        </details>
      ) : null}
      <div className="row">
        <input className="input" style={{ flex: 1, minWidth: 200 }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Answer shown to the students (optional)" />
        {report.status === 'open' ? (
          <>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => setStatus('resolved')}>Fixed</button>
            <button type="button" className="btn" disabled={busy} onClick={() => setStatus('rejected')}>Test is right</button>
          </>
        ) : (
          <button type="button" className="btn" disabled={busy} onClick={() => setStatus('open')}>Reopen</button>
        )}
      </div>
      {error ? <div className="notice error">{error}</div> : null}
    </div>
  );
}

export function ReportsAdmin({ slug, reports }: { slug: string; reports: AdminReport[] }) {
  const [error, setError] = useState<string | null>(null);
  const open = reports.filter((r) => r.status === 'open').length;
  if (reports.length === 0) return <div className="card muted">No report on this assignment.</div>;
  return (
    <div className="stack-lg">
      <section className="card stack">
        <div className="spread">
          <h3>{open} open report(s)</h3>
          <button
            type="button"
            className="btn"
            onClick={async () => {
              setError(null);
              try {
                downloadJson(await adminFetch(`/assignments/${encodeURIComponent(slug)}/export/reports`), `${slug}-reports.json`);
              } catch (err) {
                setError((err as Error).message);
              }
            }}
          >
            Export reports (JSON)
          </button>
        </div>
        <p className="small muted">
          Students who pushed on this assignment report tests they believe are wrong and vote on each other&apos;s reports.
          Fix the testsuite in <em>Tests &amp; publishing</em> (<em>Update only these files</em>), publish again, then mark
          each report <em>Fixed</em> or <em>Test is right</em> with an answer. The export holds the reports and the current
          test files, anonymously.
        </p>
        {error ? <div className="notice error">{error}</div> : null}
      </section>
      <div className="stack" style={{ gap: 'var(--s-2)' }}>
        {reports.map((r) => <ReportCard key={r.id} report={r} />)}
      </div>
    </div>
  );
}
