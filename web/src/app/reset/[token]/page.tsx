// Password reset link created by an operator: single use, expiring.
import { publicApi } from '@/lib/api';
import { Logo } from '@/components/Logo';
import { PublicFooter } from '@/components/Notices';
import { ResetForm } from './ResetForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'New password' };

export default async function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const check = await publicApi<{ valid: boolean; login?: string }>(`/reset/${encodeURIComponent(token)}`).catch(() => ({ valid: false, login: undefined }));
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 'var(--s-5)' }}>
      <div className="stack-lg" style={{ width: '100%', maxWidth: 440 }}>
        <div className="card stack-lg" style={{ padding: 'var(--s-6)' }}>
          <div style={{ display: 'flex', justifyContent: 'center' }}><Logo height={36} /></div>
          {check.valid ? (
            <>
              <div className="stack" style={{ gap: 'var(--s-2)' }}>
                <h2>Choose a new password</h2>
                <p className="small muted">For the account <strong className="mono">{check.login}</strong>.</p>
              </div>
              <ResetForm token={token} />
            </>
          ) : (
            <div className="stack" style={{ gap: 'var(--s-2)', textAlign: 'center' }}>
              <h2>Invalid link</h2>
              <p className="small muted">This link is invalid, expired or already used.</p>
            </div>
          )}
        </div>
        <PublicFooter />
      </div>
    </main>
  );
}
