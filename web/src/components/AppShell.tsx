import Link from 'next/link';
import type { Me, SessionUser } from '@/lib/auth';
import { Logo } from './Logo';
import { SignOutButton } from './AuthButtons';
import { MockBar, MockSignOutButton } from './MockControls';
import { PublicFooter, ServiceBanner } from './Notices';
import { MOCK_MODE } from '@/lib/mock/mode';
import styles from './AppShell.module.css';

type NavItem = { href: string; label: string };

const ROLE_BADGE = { operator: 'Operator', maintainer: 'Maintainer' } as const;

export function AppShell({
  user,
  area,
  nav,
  children,
}: {
  user: SessionUser & { me: Me };
  area: 'student' | 'admin';
  nav: NavItem[];
  children: React.ReactNode;
}) {
  const staff = user.role === 'operator' || user.role === 'maintainer';
  return (
    <>
      <header className={styles.header}>
        <div className={styles.inner}>
          <Link href={area === 'admin' ? '/admin' : '/'} className={styles.brand} aria-label="Home">
            <span className={styles.full}><Logo height={24} /></span>
            <span className={styles.mark}><Logo variant="mark" height={24} /></span>
            {area === 'admin' && user.role !== 'student' ? <span className={`badge s-warn ${styles.area}`}>{ROLE_BADGE[user.role]}</span> : null}
          </Link>
          <nav className={styles.nav}>
            {nav.map((item) => (
              <Link key={item.href} href={item.href} className={styles.link}>
                {item.label}
              </Link>
            ))}
          </nav>
          <div className={styles.user}>
            {area === 'student' && staff ? <Link href="/admin" className={styles.link}>Admin panel</Link> : null}
            {area === 'admin' ? <Link href="/" className={styles.link}>Student view</Link> : null}
            <Link href="/account" className="small muted mono">{user.login}</Link>
            {MOCK_MODE ? <MockSignOutButton /> : <SignOutButton />}
          </div>
        </div>
      </header>
      {MOCK_MODE ? <MockBar current={user.login} /> : null}
      <main className="page stack-lg">
        <ServiceBanner status={user.me.service} />
        {children}
        <PublicFooter />
      </main>
    </>
  );
}
