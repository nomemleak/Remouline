import { requireUser } from '@/lib/auth';
import { AppShell } from '@/components/AppShell';

export const dynamic = 'force-dynamic';

export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <AppShell
      user={user}
      area="student"
      nav={[
        { href: '/', label: 'Assignments' },
        { href: '/invites', label: 'Invitations' },
        { href: '/account', label: 'Account' },
      ]}
    >
      {children}
    </AppShell>
  );
}
