'use client';

// Maintainers: import a testsuite bundle (Criterion tests + headers + optional flags,
// see docs/BUNDLE-FORMAT.md) -> automatic validation against two generated EMPTY
// implementations -> if it fails, export the report as JSON -> Publish (only when the
// validation passed).
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { adminFetch, downloadJson } from '@/lib/admin-client';
import { parsePastedBundle, readBundleUpload, type PastedBundle } from '@/lib/uploads';
import { formatDate } from '@/lib/format';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { IconAlert, IconCheck, IconClock, IconCross, IconUpload } from '@/components/Icons';

type SourceFile = { path: string; content: string };

export type AssignmentPayload = {
  assignment: {
    slug: string; title: string; status: 'draft' | 'published'; tests_version: number;
    validation_status: 'none' | 'running' | 'passed' | 'failed';
    validation_report: {
      stubSubmissionId: number; otherSubmissionId?: number; startedAt: string; finishedAt?: string; stubNotes?: string[];
      voidFunctions?: string[]; blocking?: string[]; warnings?: string[];
    } | null;
    published_at: string | null;
    compile_flags: string | null;
    flag_overrides: string | null;
    flags_source?: 'bundle' | 'admin' | 'fallback';
  };
  defaultCompileFlags: string;
  attestation: { version: number; text: string };
  stagingFiles: SourceFile[];
  headerFiles: SourceFile[];
  stubFiles: SourceFile[];
  stubOtherFiles: SourceFile[];
  publishedFiles: string[];
  preview: { tests: { file: string; category_path: string; test_name: string }[]; warnings: string[]; count: number };
  stagingDiffersFromPublished: boolean;
};

type Mode = 'merge' | 'replace';

function Step({ n, title, done, children }: { n: number; title: string; done: boolean; children: React.ReactNode }) {
  return (
    <section className="card stack">
      <h3 className="row">
        <span className={`badge ${done ? 's-pass' : 's-running'}`}>{done ? <IconCheck size={12} /> : n}</span>
        {title}
      </h3>
      {children}
    </section>
  );
}

function FilePicker({ label, onFiles, directory, accept }: { label: string; onFiles: (files: FileList) => void; directory?: boolean; accept?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (directory && ref.current) ref.current.setAttribute('webkitdirectory', '');
  }, [directory]);
  return (
    <label className="btn">
      <IconUpload /> {label}
      <input
        ref={ref}
        type="file"
        multiple={!accept}
        accept={accept}
        hidden
        onChange={(e) => {
          if (e.target.files?.length) onFiles(e.target.files);
          e.target.value = '';
        }}
      />
    </label>
  );
}

function Preview({ preview }: { preview: AssignmentPayload['preview'] }) {
  const groups = new Map<string, string[]>();
  for (const t of preview.tests) groups.set(t.category_path, [...(groups.get(t.category_path) ?? []), t.test_name]);
  return (
    <details>
      <summary className="small muted" style={{ cursor: 'pointer' }}>Detected tests ({preview.count})</summary>
      <div className="stack" style={{ gap: 'var(--s-2)', marginTop: 'var(--s-2)' }}>
        {preview.warnings.map((w) => <div key={w} className="notice small">{w}</div>)}
        <div className="codeblock" style={{ whiteSpace: 'normal' }}>
          {[...groups.entries()].map(([path, tests]) => (
            <div key={path} style={{ marginBottom: 'var(--s-2)' }}>
              <div className="s-warn">{path}</div>
              {tests.map((t) => <div key={t} style={{ paddingLeft: 'var(--s-5)' }}>└ {t}</div>)}
            </div>
          ))}
          {preview.count === 0 ? <span className="faint">No test detected yet.</span> : null}
        </div>
      </div>
    </details>
  );
}

/** Default flags + per-exercise exceptions; saving re-runs the validation. */
function CompilationFlags({ data, onSave, busy }: { data: AssignmentPayload; onSave: (flags: string, overrides: string) => void; busy: boolean }) {
  const current = data.assignment.compile_flags || data.defaultCompileFlags;
  const [flags, setFlags] = useState(current);
  const [overrides, setOverrides] = useState(data.assignment.flag_overrides ?? '');
  useEffect(() => {
    setFlags(data.assignment.compile_flags || data.defaultCompileFlags);
    setOverrides(data.assignment.flag_overrides ?? '');
  }, [data.assignment.compile_flags, data.assignment.flag_overrides, data.defaultCompileFlags]);
  const changed = flags.trim() !== current || overrides.trim() !== (data.assignment.flag_overrides ?? '').trim();
  const source = data.assignment.flags_source ?? 'fallback';
  const SOURCE_LABEL = {
    bundle: 'from remouline/flags.txt in the bundle',
    admin: 'set in the admin panel',
    fallback: 'server fallback',
  } as const;
  return (
    <section className="card stack">
      <div className="spread">
        <h3>Compilation flags of this assignment</h3>
        <span className={`badge ${source === 'fallback' ? 's-warn' : 's-pass'}`}>{SOURCE_LABEL[source]}</span>
      </div>
      <p className="small muted">
        Each assignment has its own flags, used to compile student code (not the test files). They normally come
        from <code>remouline/flags.txt</code> in the bundle; edit them here only to check or fix them. When the
        assignment provides a <code>Makefile</code> for a folder, write <code>folder: makefile</code>: programs are
        built with it and the flags are read from it. Without that line, students&apos; Makefiles are never run.
      </p>
      {source === 'fallback' ? (
        <div className="notice small">
          The bundle gave no flags: the server fallback (<code>DEFAULT_COMPILE_FLAGS</code>) is used. Check the flags the
          assignment requires and set them below.
        </div>
      ) : null}
      <label className="field">
        Default flags
        <input className="input mono" value={flags} onChange={(e) => setFlags(e.target.value)} />
      </label>
      <label className="field">
        Exceptions, one per line: <code>exercise_folder: flags</code>, <code>folder: makefile</code>, or
        <code>*: makefile</code> for every folder that has a Makefile
        <textarea className="textarea" style={{ minHeight: 70 }} value={overrides} onChange={(e) => setOverrides(e.target.value)}
          placeholder={'file_io: -pedantic -Werror -Wall -Wextra -Wvla\nfundamentals: makefile'} />
      </label>
      <div className="row">
        <button type="button" className="btn" disabled={!changed || busy || !flags.trim()} onClick={() => onSave(flags, overrides)}>
          Save flags and re-validate
        </button>
      </div>
    </section>
  );
}

export function TestsManager({ initial }: { initial: AssignmentPayload }) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pasted, setPasted] = useState('');
  const [pending, setPending] = useState<PastedBundle | null>(null);
  const [mode, setMode] = useState<Mode>(initial.stagingFiles.length > 0 ? 'merge' : 'replace');
  const [forceOpen, setForceOpen] = useState(false);
  const [attested, setAttested] = useState(false);
  const slug = data.assignment.slug;
  const base = `/assignments/${encodeURIComponent(slug)}`;

  const run = async (label: string, fn: () => Promise<AssignmentPayload | void>) => {
    setBusy(label);
    setError(null);
    try {
      const next = await fn();
      if (next) setData(next);
      router.refresh(); // server-rendered header (status badge) follows
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  // Poll while the validation runs.
  useEffect(() => {
    if (data.assignment.validation_status !== 'running') return;
    const id = setInterval(async () => {
      try {
        setData(await adminFetch<AssignmentPayload>(base));
      } catch {
        /* keep polling */
      }
    }, 3000);
    return () => clearInterval(id);
  }, [data.assignment.validation_status, base]);

  const validation = data.assignment.validation_report;
  const hasTests = data.stagingFiles.length > 0;
  const passed = data.assignment.validation_status === 'passed';
  const pendingCount = pending ? pending.tests.length + pending.headers.length + (pending.flags ? 1 : 0) : 0;
  const pick = async (files: FileList) => {
    try {
      setPending(await readBundleUpload(files, slug));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const importPending = () =>
    run('import', async () => {
      const next = await adminFetch<AssignmentPayload>(`${base}/bundle`, {
        method: 'PUT',
        body: { tests: pending!.tests, headers: pending!.headers, flags: pending!.flags ?? null, mode, attest: attested },
      });
      setPending(null);
      setAttested(false);
      setPasted('');
      setMode('merge');
      return next;
    });

  return (
    <div className="stack-lg">
      {error ? <div className="notice error">{error}</div> : null}

      <Step n={1} title="Import a testsuite bundle" done={hasTests}>
        <p className="small muted">
          Paste a bundle as-is, or upload it as a single <code>.txt</code> / <code>.zip</code>, files or a folder. Files
          under <code>headers/…</code> are the headers students must write (declarations only, used to build the empty
          implementations), <code>remouline/flags.txt</code> holds the compilation flags, the others are Criterion tests.
          See the bundle format in <code>docs/BUNDLE-FORMAT.md</code>.
        </p>
        <div className="row small" style={{ gap: 'var(--s-4)' }}>
          <span className={hasTests ? 's-pass' : 'faint'}>{data.stagingFiles.length} test file(s)</span>
          <span className={data.headerFiles.length ? 's-pass' : 'faint'}>{data.headerFiles.length} header(s)</span>
        </div>
        <textarea
          className="textarea"
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          placeholder={'===== FILE: Fundamentals/address_book/test_address_book.c =====\n#include <criterion/criterion.h>\n...\n===== FILE: headers/Fundamentals/address_book/address_book.h =====\n...\n===== END ====='}
        />
        <div className="row">
          <button type="button" className="btn btn-primary" disabled={!pasted.trim()} onClick={() => setPending(parsePastedBundle(pasted, slug))}>
            Read pasted bundle
          </button>
          <span className="small faint">or upload:</span>
          <FilePicker label="One .txt / .zip" accept=".txt,.md,.zip" onFiles={pick} />
          <FilePicker label="Files" onFiles={pick} />
          <FilePicker label="Folder" directory onFiles={pick} />
        </div>

        {pending ? (
          <div className="stack" style={{ gap: 'var(--s-2)' }}>
            {pending.errors.map((e) => <div key={e} className="notice small">{e}</div>)}
            <div className="grid-2">
              {(['tests', 'headers'] as const).map((group) => (
                <div key={group} className="stack" style={{ gap: 4 }}>
                  <span className="caption">{group === 'tests' ? 'Test files' : 'Headers'} ({pending[group].length})</span>
                  <pre className="codeblock" style={{ maxHeight: 160 }}>{pending[group].map((f) => f.path).join('\n') || '—'}</pre>
                </div>
              ))}
            </div>
            {pending.flags ? (
              <div className="stack" style={{ gap: 4 }}>
                <span className="caption">Compilation flags (remouline/flags.txt)</span>
                <pre className="codeblock">{pending.flags.trim()}</pre>
              </div>
            ) : null}
            <div className="stack" style={{ gap: 4 }}>
              <label className="row small" style={{ cursor: 'pointer' }}>
                <input type="radio" name="mode" checked={mode === 'merge'} onChange={() => setMode('merge')} />
                Update only these files (keep all the others). Use this for fixes.
              </label>
              <label className="row small" style={{ cursor: 'pointer' }}>
                <input type="radio" name="mode" checked={mode === 'replace'} onChange={() => setMode('replace')} />
                Replace everything (tests and/or headers present above replace the current ones).
              </label>
            </div>
            <label className="row small notice" style={{ cursor: 'pointer', alignItems: 'start' }}>
              <input type="checkbox" checked={attested} onChange={(e) => setAttested(e.target.checked)} />
              <span>{data.attestation.text}</span>
            </label>
            <div className="row">
              <button type="button" className="btn btn-primary" disabled={pendingCount === 0 || busy !== null || !attested} onClick={importPending}>
                Import {pendingCount} file(s)
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setPending(null)}>Cancel</button>
            </div>
          </div>
        ) : null}
        {hasTests ? <Preview preview={data.preview} /> : null}
      </Step>

      <CompilationFlags
        data={data}
        busy={busy !== null}
        onSave={(flags, overrides) => run('flags', () => adminFetch(base, { method: 'PATCH', body: { compile_flags: flags, flag_overrides: overrides } }))}
      />

      <Step n={2} title="Automatic validation (empty implementations)" done={passed}>
        <p className="small muted">
          Remouline builds two empty implementations from the headers, one returning 0 / NULL and one returning non-zero
          values (programs print nothing / print a line), and grades both with the real pipeline. Every test file must
          compile, and every function (Criterion suite) must have at least one test failing on one of them: a test
          expecting NULL fails on the second one, so error cases are fine. No solution is ever generated.
        </p>
        {data.assignment.validation_status === 'none' ? <p className="small faint">Starts automatically after an import.</p> : null}
        {data.assignment.validation_status === 'running' ? (
          <div className="row s-running"><IconClock /> Grading the empty implementations…</div>
        ) : null}
        {passed ? (
          <div className="row s-pass"><IconCheck /> Validation passed: every test compiles and every function&apos;s tests catch empty code.</div>
        ) : null}
        {data.assignment.validation_status === 'failed' ? (
          <div className="stack" style={{ gap: 'var(--s-3)' }}>
            <div className="row s-fail"><IconCross /> Validation failed ({validation?.blocking?.length ?? 0} problem(s)).</div>
            <pre className="codeblock wrap">{(validation?.blocking ?? []).join('\n')}</pre>
            <div className="row">
              <button type="button" className="btn" disabled={busy !== null}
                onClick={() => run('export', async () => {
                  downloadJson(await adminFetch(`${base}/export/validation`), `${slug}-validation-report.json`);
                })}>
                Export validation report (JSON)
              </button>
              <span className="small faint">Every result of both runs, with the current test files and headers.</span>
            </div>
          </div>
        ) : null}
        {validation?.warnings?.length ? (
          <details>
            <summary className="small muted" style={{ cursor: 'pointer' }}>
              <IconAlert size={12} /> {validation.warnings.length} test(s) pass on both empty implementations (informational: e.g. &quot;does not crash on NULL&quot;)
            </summary>
            <pre className="codeblock wrap">{validation.warnings.join('\n')}</pre>
          </details>
        ) : null}
        {validation?.stubSubmissionId ? (
          <div className="row small">
            <Link href={`/admin/submissions/${validation.stubSubmissionId}`}>Results on the 0 / NULL version</Link>
            {validation.otherSubmissionId ? (
              <Link href={`/admin/submissions/${validation.otherSubmissionId}`}>Results on the non-zero version</Link>
            ) : null}
            {validation.finishedAt ? <span className="faint">finished {formatDate(validation.finishedAt)}</span> : null}
          </div>
        ) : null}
        {([['0 / NULL', data.stubFiles], ['non-zero', data.stubOtherFiles ?? []]] as const).map(([label, files]) =>
          files.length ? (
            <details key={label}>
              <summary className="small muted" style={{ cursor: 'pointer' }}>Generated empty implementation, {label} version ({files.length} file(s))</summary>
              <pre className="codeblock" style={{ maxHeight: 360, marginTop: 'var(--s-2)' }}>
                {files.map((f) => `===== ${f.path} =====\n${f.content}`).join('\n')}
              </pre>
            </details>
          ) : null,
        )}
        <div>
          <button type="button" className="btn" disabled={!hasTests || busy !== null || data.assignment.validation_status === 'running'}
            onClick={() => run('validate', () => adminFetch(`${base}/validate`, { method: 'POST' }))}>
            Re-run validation
          </button>
        </div>
      </Step>

      <Step n={3} title="Publish" done={data.assignment.status === 'published' && !data.stagingDiffersFromPublished}>
        <p className="small muted">
          Publishing copies the validated tests to <code>tp-{slug}/tests/</code> and opens the assignment to students.
          {data.assignment.status === 'published' && data.stagingDiffersFromPublished
            ? ' The draft tests differ from the published ones: publish again to update them.'
            : ''}
        </p>
        <div className="row">
          <button type="button" className="btn btn-primary" disabled={!passed || busy !== null}
            onClick={() => run('publish', () => adminFetch(`${base}/publish`, { method: 'POST' }))}>
            Publish
          </button>
          {data.assignment.status === 'published' ? (
            <button type="button" className="btn btn-danger" disabled={busy !== null}
              onClick={() => run('unpublish', () => adminFetch(`${base}/unpublish`, { method: 'POST' }))}>
              Unpublish
            </button>
          ) : null}
          {!passed ? <span className="small faint">Blocked until the validation passes.</span> : null}
          {data.assignment.validation_status === 'failed' ? (
            <button type="button" className="btn btn-danger" disabled={busy !== null} onClick={() => setForceOpen(true)}>
              Publish anyway…
            </button>
          ) : null}
        </div>
        <ConfirmDialog
          open={forceOpen}
          danger
          busy={busy === 'publish'}
          title="Publish despite the failed validation?"
          confirmLabel="Publish anyway"
          onClose={() => setForceOpen(false)}
          onConfirm={() => run('publish', async () => {
            const next = await adminFetch<AssignmentPayload>(`${base}/publish`, { method: 'POST', body: { force: true } });
            setForceOpen(false);
            return next;
          })}
        >
          <p>Only do this for a false positive, e.g. a function whose only requirement is to not crash on NULL.</p>
          <p>
            Remaining problem(s): {validation?.blocking?.length ?? 0}. Tests that do not compile would show as errors to every
            student. The override is recorded in the activity log.
          </p>
        </ConfirmDialog>
      </Step>
      {busy ? <div className="small faint">Working ({busy})…</div> : null}
    </div>
  );
}
