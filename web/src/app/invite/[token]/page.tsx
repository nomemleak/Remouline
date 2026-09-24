// Invitation page: without a valid, unused, unexpired token there is nothing here
// (no open sign-up page exists anywhere). It never says who created the invitation.
import { publicApi } from '@/lib/api';
import { APP_NAME } from '@/lib/app';
import { Logo } from '@/components/Logo';
import { IndependentNotice, PublicFooter } from '@/components/Notices';
import { RedeemForm } from './RedeemForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Invitation' };

type Check = { valid: boolean; paused?: boolean; login?: string | null; email?: string | null; role?: 'student' | 'maintainer' };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const check = await publicApi<Check>(`/invite/${encodeURIComponent(token)}`).catch((): Check => ({ valid: false }));
  const maintainer = check.role === 'maintainer';
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 'var(--s-5)' }}>
      <div className="stack-lg" style={{ width: '100%', maxWidth: 480 }}>
        <div className="card stack-lg" style={{ padding: 'var(--s-6)' }}>
          <div style={{ display: 'flex', justifyContent: 'center' }}><Logo height={36} /></div>
          {check.valid ? (
            <>
              <div className="stack" style={{ gap: 'var(--s-2)' }}>
                <h2>You are invited</h2>
                <p className="small muted">
                  {maintainer
                    ? `Create your ${APP_NAME} maintainer account. Its login was generated at random: it is your pseudonym here, keep it.`
                    : `Create your ${APP_NAME} account.`}
                </p>
                {maintainer ? null : <IndependentNotice />}
              </div>
              <RedeemForm token={token} preset={{ login: check.login ?? null, email: check.email ?? null }} maintainer={maintainer} />
            </>
          ) : (
            <div className="stack" style={{ gap: 'var(--s-2)', textAlign: 'center' }}>
              <h2>{check.paused ? 'Service paused' : 'Invalid invitation'}</h2>
              <p className="small muted">
                {check.paused
                  ? 'Accounts cannot be created while the service is paused. Try again later.'
                  : 'This link is invalid, expired, revoked or already used.'}
              </p>
            </div>
          )}
        </div>
        <PublicFooter />
      </div>
    </main>
  );
}
