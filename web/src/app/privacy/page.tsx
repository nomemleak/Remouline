import { LegalPage } from '@/components/LegalPage';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Privacy' };

export default function Page() {
  return <LegalPage name="privacy" />;
}
