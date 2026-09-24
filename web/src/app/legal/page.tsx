import { LegalPage } from '@/components/LegalPage';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Legal notice' };

export default function Page() {
  return <LegalPage name="legal" />;
}
