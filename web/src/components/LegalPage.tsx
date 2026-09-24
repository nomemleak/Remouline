// Public page (no login needed): terms of use, privacy notice or legal notice, as
// written by the operator in Admin > Settings.
import Link from 'next/link';
import { publicApi } from '@/lib/api';
import { Logo } from './Logo';
import { PublicFooter } from './Notices';
import { SimpleMarkdown } from './SimpleMarkdown';

export async function LegalPage({ name }: { name: 'terms' | 'privacy' | 'legal' }) {
  const page = await publicApi<{ text: string }>(`/public/pages/${name}`).catch(() => null);
  return (
    <main className="page stack-lg" style={{ maxWidth: 780 }}>
      <Link href="/" aria-label="Home"><Logo height={28} /></Link>
      <article className="card">
        {page ? <SimpleMarkdown text={page.text} /> : <p className="muted">This page is unavailable right now.</p>}
      </article>
      <PublicFooter />
    </main>
  );
}
