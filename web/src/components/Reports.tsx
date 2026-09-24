'use client';

// Student-side reports: "this test looks wrong" + votes of the other students.
import { useState, useTransition } from 'react';
import { createReportAction, voteReportAction } from '@/app/(student)/assignments/[slug]/actions';
import { escapeForDisplay } from '@/lib/escape';
import { IconAlert, IconCheck, IconCross } from './Icons';

export type StudentReport = {
  id: number; category_path: string; test_name: string; message: string; status: 'open' | 'resolved' | 'rejected';
  admin_note: string | null; agree: number; disagree: number; my_vote: number | null; mine: boolean; created_at: string;
};

export type ReportingContext = { slug: string; reports: StudentReport[]; canParticipate: boolean };

const STATUS_LABEL = { open: 'Open', resolved: 'Fixed by the admin', rejected: 'Test confirmed correct' } as const;
const STATUS_TONE = { open: 's-warn', resolved: 's-pass', rejected: 's-running' } as const;

export function ReportItem({ report, slug, canParticipate }: { report: StudentReport; slug: string; canParticipate: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const vote = (v: 1 | -1) =>
    start(async () => {
      const res = await voteReportAction(slug, report.id, report.my_vote === v ? 0 : v);
      setError(res.error ?? null);
    });
  return (
    <div className="card card-tight stack" style={{ gap: 'var(--s-2)', background: 'var(--c-surface-raised)' }}>
      <div className="spread">
        <span className="mono small" style={{ overflowWrap: 'anywhere' }}>{report.category_path}/<strong>{report.test_name}</strong></span>
        <span className={`badge ${STATUS_TONE[report.status]}`}>{STATUS_LABEL[report.status]}</span>
      </div>
      <p className="small">{escapeForDisplay(report.message)}{report.mine ? <span className="faint"> (your report)</span> : null}</p>
      {report.admin_note ? <div className="notice small ok">Admin: {escapeForDisplay(report.admin_note)}</div> : null}
      <div className="row small">
        <span className="muted">Is this test wrong?</span>
        <button type="button" className={`btn ${report.my_vote === 1 ? 'btn-primary' : ''}`} style={{ height: 28 }}
          disabled={pending || !canParticipate || report.status !== 'open'} onClick={() => vote(1)}>
          <IconCheck size={12} /> Agree · {report.agree}
        </button>
        <button type="button" className={`btn ${report.my_vote === -1 ? 'btn-primary' : ''}`} style={{ height: 28 }}
          disabled={pending || !canParticipate || report.status !== 'open'} onClick={() => vote(-1)}>
          <IconCross size={12} /> Disagree · {report.disagree}
        </button>
        {!canParticipate ? <span className="faint">Push at least once on this assignment to vote.</span> : null}
      </div>
      {error ? <div className="notice error small">{error}</div> : null}
    </div>
  );
}

/** Shown in the detail of a test: existing reports on it + a form to open a new one. */
export function TestReports({ ctx, resultId, categoryPath, testName }: { ctx: ReportingContext; resultId: number; categoryPath: string; testName: string }) {
  const related = ctx.reports.filter((r) => r.category_path === categoryPath && r.test_name === testName);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [pending, start] = useTransition();
  const [feedback, setFeedback] = useState<{ ok?: boolean; error?: string } | null>(null);

  return (
    <div className="stack" style={{ gap: 'var(--s-2)' }}>
      {related.some((r) => r.status === 'open') ? (
        <div className="notice small">
          <IconAlert size={12} /> Other students think this test may be wrong. Check the report below before spending hours on it.
        </div>
      ) : null}
      {related.map((r) => <ReportItem key={r.id} report={r} slug={ctx.slug} canParticipate={ctx.canParticipate} />)}
      {ctx.canParticipate ? (
        open ? (
          <form
            className="stack"
            style={{ gap: 'var(--s-2)' }}
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                const res = await createReportAction(ctx.slug, resultId, message);
                setFeedback(res);
                if (res.ok) {
                  setOpen(false);
                  setMessage('');
                }
              });
            }}
          >
            <label className="field">
              Why do you think this test is wrong? Quote the subject if you can.
              <textarea className="textarea" style={{ minHeight: 90, fontFamily: 'var(--f-sans)' }} value={message}
                onChange={(e) => setMessage(e.target.value)} minLength={10} maxLength={2000} required />
            </label>
            <div className="row">
              <button className="btn btn-primary" disabled={pending || message.trim().length < 10}>Send report</button>
              <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
              <span className="small faint">Other students will see it (not your name) and vote.</span>
            </div>
          </form>
        ) : (
          <div>
            <button type="button" className="btn" onClick={() => { setFeedback(null); setOpen(true); }}>
              <IconAlert /> {related.length ? 'Open another report on this test' : 'Report this test as wrong'}
            </button>
          </div>
        )
      ) : null}
      {feedback?.ok ? <div className="notice ok small">Report sent. Thanks!</div> : null}
      {feedback?.error ? <div className="notice error small">{feedback.error}</div> : null}
    </div>
  );
}
