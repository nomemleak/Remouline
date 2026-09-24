import Link from 'next/link';
import type { Role } from '@/lib/auth';
import { DeleteAssignment } from './DeleteAssignment';
import { UnpublishButton } from './UnpublishButton';

type Tab = 'activity' | 'tests' | 'reports';

// Operators see the activity (who pushed) and can take an assignment down; maintainers
// see the testsuite and the anonymous reports.
const TABS: Record<'operator' | 'maintainer', { key: Tab; path: string; label: string }[]> = {
  operator: [{ key: 'activity', path: '', label: 'Activity' }],
  maintainer: [
    { key: 'tests', path: '/tests', label: 'Tests & publishing' },
    { key: 'reports', path: '/reports', label: 'Reports' },
  ],
};

export function AssignmentHeader({ slug, title, status, tab, role }: { slug: string; title: string; status: string; tab: Tab; role: Role }) {
  const base = `/admin/assignments/${encodeURIComponent(slug)}`;
  const tabs = TABS[role === 'operator' ? 'operator' : 'maintainer'];
  return (
    <div className="stack" style={{ gap: 'var(--s-3)' }}>
      <Link href="/admin" className="small">← Assignments</Link>
      <div className="spread">
        <div className="stack" style={{ gap: 2 }}>
          <h1>{title}</h1>
          <span className="small faint mono">{slug}</span>
        </div>
        <div className="row">
          <span className={`badge ${status === 'published' ? 's-pass' : 's-running'}`}>{status}</span>
          {role === 'operator' && status === 'published' ? <UnpublishButton slug={slug} /> : null}
          <DeleteAssignment slug={slug} />
        </div>
      </div>
      <div className="row" style={{ borderBottom: '1px solid var(--c-border)', gap: 0 }}>
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={`${base}${t.path}`}
            className="small"
            style={{
              padding: 'var(--s-2) var(--s-4)',
              color: tab === t.key ? 'var(--c-text)' : 'var(--c-text-muted)',
              borderBottom: `2px solid ${tab === t.key ? 'var(--c-accent)' : 'transparent'}`,
              marginBottom: -1,
              fontWeight: 500,
            }}
          >
            {t.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
