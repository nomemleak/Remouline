// Shown when the terms of use changed since the user accepted them (or for accounts
// created outside an invitation, e.g. the operator's): nothing else is reachable
// until the current version is accepted.
import { redirect } from 'next/navigation';
import { getUser, type Me } from '@/lib/auth';
import { publicApi, studentApi } from '@/lib/api';
import { Logo } from '@/components/Logo';
import { SimpleMarkdown } from '@/components/SimpleMarkdown';
import { SignOutButton } from '@/components/AuthButtons';
import { AcceptTerms } from './AcceptTerms';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Terms of use' };

export default async function AcceptTermsPage() {
  const user = await getUser();
  if (!user) redirect('/login');
  const [me, page] = await Promise.all([
    studentApi<Me>(user.login, '/me').catch(() => null),
    publicApi<{ text: string }>('/public/pages/terms').catch(() => null),
  ]);
  if (!me) redirect('/login?error=disabled');
  if (me.termsAccepted) redirect('/');
  return (
    <main className="page stack-lg" style={{ maxWidth: 780 }}>
      <div className="spread">
        <Logo height={28} />
        <SignOutButton />
      </div>
      <div className="notice">The terms of use changed. Read and accept them to continue.</div>
      <article className="card">{page ? <SimpleMarkdown text={page.text} /> : null}</article>
      <AcceptTerms />
    </main>
  );
}
