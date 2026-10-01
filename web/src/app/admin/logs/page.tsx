import Link from 'next/link';
import { requireStaff } from '@/lib/auth';
import { adminApi } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { escapeForDisplay } from '@/lib/escape';
import { ErrorState } from '@/components/ErrorState';

export const metadata = { title: 'Logs' };

type Log = { id: number; ts: string; service: string; level: string; message: string; context: string | null };
const LEVEL_TONE: Record<string, string> = { error: 's-fail', warn: 's-warn', info: 'muted' };

export default async function LogsPage({ searchParams }: { searchParams: Promise<{ service?: string; level?: string; q?: string; before?: string }> }) {
  const filters = await searchParams;
  const admin = await requireStaff('operator');
  const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v) as [string, string][]);
  let data: { logs: Log[] };
  try {
    data = await adminApi(admin.login, `/logs?${qs}`);
  } catch (error) {
    return <ErrorState error={error} />;
  }
  const oldest = data.logs[data.logs.length - 1];
  const next = new URLSearchParams(qs);
  if (oldest) next.set('before', String(oldest.id));

  return (
    <div className="stack-lg">
      <div className="stack" style={{ gap: 'var(--s-1)' }}>
        <h1>Logs</h1>
        <span className="small muted">Worker, webhook, API and admin logs. Per-job container output is in each submission&apos;s job log.</span>
      </div>
      <form className="row" method="get">
        <select className="select" name="service" defaultValue={filters.service ?? ''} style={{ width: 160 }}>
          <option value="">All services</option>
          {['worker', 'webhook', 'api', 'admin'].map((s) => <option key={s}>{s}</option>)}
        </select>
        <select className="select" name="level" defaultValue={filters.level ?? ''} style={{ width: 140 }}>
          <option value="">All levels</option>
          {['error', 'warn', 'info'].map((s) => <option key={s}>{s}</option>)}
        </select>
        <input className="input" name="q" defaultValue={filters.q ?? ''} placeholder="Search" style={{ width: 260 }} />
        <button className="btn">Filter</button>
        <Link href="/admin/logs" className="btn btn-ghost">Reset</Link>
      </form>
      <div className="card card-tight table-wrap">
        <table className="table mono">
          <tbody>
            {data.logs.length === 0 ? <tr><td className="muted">No log.</td></tr> : null}
            {data.logs.map((l) => (
              <tr key={l.id}>
                <td className="faint" style={{ whiteSpace: 'nowrap' }}>{formatDate(l.ts)}</td>
                <td>{l.service}</td>
                <td className={LEVEL_TONE[l.level] ?? ''}>{l.level}</td>
                <td style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {escapeForDisplay(l.message)}
                  {l.context ? <div className="faint">{escapeForDisplay(l.context)}</div> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.logs.length >= 300 ? <Link href={`/admin/logs?${next}`} className="btn" style={{ alignSelf: 'flex-start' }}>Older</Link> : null}
    </div>
  );
}
