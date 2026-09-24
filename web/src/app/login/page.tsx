import { redirect } from 'next/navigation';
import { getUser } from '@/lib/auth';
import { APP_NAME } from '@/lib/app';
import { Logo } from '@/components/Logo';
import { LoginForm } from '@/components/AuthButtons';
import { MockLogin } from '@/components/MockControls';
import { PublicFooter, ServiceBanner } from '@/components/Notices';
import { MOCK_MODE } from '@/lib/mock/mode';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Log in' };

const ERRORS: Record<string, string> = {
  disabled: 'This account is disabled or no longer exists.',
  Default: 'Login failed. Try again.',
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; callbackUrl?: string }> }) {
  const params = await searchParams;
  if (!params.error && (await getUser())) redirect('/');
  const error = params.error ? ERRORS[params.error] ?? ERRORS.Default : null;
  const callbackUrl = params.callbackUrl?.startsWith('/') && !params.callbackUrl.startsWith('//') ? params.callbackUrl : '/';

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 'var(--s-5)' }}>
      <div className="stack-lg" style={{ width: '100%', maxWidth: 420 }}>
        <ServiceBanner />
        <div className="card stack-lg" style={{ padding: 'var(--s-6)' }}>
          <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--s-3) 0' }}>
            <Logo height={40} />
          </div>
          <div className="stack" style={{ gap: 'var(--s-2)', textAlign: 'center' }}>
            <h2>Sign in</h2>
            <p className="muted small">
              {APP_NAME} is invitation-only. Use the login and password you chose with your invitation link.
            </p>
          </div>
          {error ? <div className="notice error">{error}</div> : null}
          {MOCK_MODE ? <MockLogin /> : <LoginForm callbackUrl={callbackUrl} />}
        </div>
        <PublicFooter />
      </div>
    </main>
  );
}
