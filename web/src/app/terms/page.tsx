import { LegalPage } from '@/components/LegalPage';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Terms of use' };

export default function Page() {
  return <LegalPage name="terms" />;
}
