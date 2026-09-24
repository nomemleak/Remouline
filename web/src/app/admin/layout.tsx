import { requireStaff } from '@/lib/auth';
import { AppShell } from '@/components/AppShell';

export const dynamic = 'force-dynamic';
export const metadata = { title: { default: 'Admin', template: '%s · Admin' } };

// Operators run the instance; maintainers only see testsuites (never who the students are).
const NAV = {
  operator: [
    { href: '/admin', label: 'Assignments' },
    { href: '/admin/students', label: 'Students' },
    { href: '/admin/maintainers', label: 'Maintainers' },
    { href: '/admin/access', label: 'Access' },
    { href: '/admin/logs', label: 'Logs' },
    { href: '/admin/settings', label: 'Settings' },
  ],
  maintainer: [{ href: '/admin', label: 'Assignments' }],
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireStaff();
  return (
    <AppShell user={user} area="admin" nav={NAV[user.role === 'operator' ? 'operator' : 'maintainer']}>
      {children}
    </AppShell>
  );
}
