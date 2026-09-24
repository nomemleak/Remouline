import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { AccountControls } from './AccountControls';

export const metadata = { title: 'Account' };

export default async function AccountPage() {
  const user = await requireUser();
  return (
    <div className="stack-lg" style={{ maxWidth: 760 }}>
      <div className="stack" style={{ gap: 'var(--s-1)' }}>
        <h1>Account</h1>
        <span className="small muted">
          <span className="mono">{user.login}</span>
          {user.me.email ? ` · ${user.me.email}` : ''} · created {formatDate(user.me.createdAt)}
        </span>
      </div>
      <AccountControls login={user.login} operator={user.role === 'operator'} />
      <p className="small faint">
        What is stored about you, and for how long: see the <Link href="/privacy">privacy notice</Link>.
      </p>
    </div>
  );
}
