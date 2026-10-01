import Link from 'next/link';
import { requireStaff } from '@/lib/auth';
import { adminApi } from '@/lib/api';
import type { Submission, TestResult } from '@/lib/types';
import { formatDate, formatDuration, shortSha } from '@/lib/format';
import { escapeForDisplay } from '@/lib/escape';
import { ErrorState } from '@/components/ErrorState';
import { SubmissionBadge } from '@/components/StatusBadge';
import { AutoRefresh } from '@/components/AutoRefresh';
import { ResultTree } from '@/components/ResultTree';
import { SubmissionMessage } from '@/components/SubmissionMessage';
import { RerunButton } from './RerunButton';

export default async function AdminSubmission({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = await requireStaff();
  let data: { submission: Submission; results: TestResult[] };
  try {
    data = await adminApi(admin.login, `/submissions/${encodeURIComponent(id)}`);
  } catch (error) {
    return <ErrorState error={error} />;
  }
  const s = data.submission;
  const back = s.assignment ? `/admin/assignments/${encodeURIComponent(s.assignment)}${s.kind === 'validation' ? '/tests' : ''}` : '/admin';

  return (
    <div className="stack-lg">
      <AutoRefresh active={['queued', 'running'].includes(s.status)} />
      <div className="stack" style={{ gap: 'var(--s-1)' }}>
        <Link href={back} className="small">← {s.assignment ?? 'Assignments'}</Link>
        <div className="spread">
          <h1>
            {s.kind === 'validation' ? `Validation run (${s.validation_role === 'stub_other' ? 'non-zero' : '0 / NULL'} empty implementation)` : `Submission #${s.id}`}
          </h1>
          <div className="row">
            <SubmissionBadge status={s.status} passed={s.passed} total={s.total} />
            <RerunButton id={s.id} disabled={['queued', 'running'].includes(s.status)} />
          </div>
        </div>
        <span className="small faint mono">
          {s.kind === 'push' ? (
            <>
              <Link href={`/admin/students/${encodeURIComponent(s.student ?? '')}`}>{s.student}</Link> · {s.repo_name} @ {shortSha(s.commit_sha)} ·{' '}
            </>
          ) : null}
          created {formatDate(s.created_at)} · duration {formatDuration(s.duration_ms)} · attempt {s.attempt}
        </span>
      </div>
      <SubmissionMessage submission={s} />
      {s.status === 'done' ? <ResultTree results={data.results} /> : null}
      <section className="stack">
        <h3>Job log</h3>
        <pre className="codeblock" style={{ maxHeight: 400 }}>{s.job_log ? escapeForDisplay(s.job_log) : '(empty)'}</pre>
      </section>
    </div>
  );
}
