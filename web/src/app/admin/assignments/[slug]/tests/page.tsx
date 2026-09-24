import { requireStaff } from '@/lib/auth';
import { adminApi } from '@/lib/api';
import { ErrorState } from '@/components/ErrorState';
import { AssignmentHeader } from '../AssignmentHeader';
import { TestsManager, type AssignmentPayload } from './TestsManager';

export const metadata = { title: 'Tests & publishing' };

export default async function TestsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const admin = await requireStaff('maintainer');
  let data: AssignmentPayload;
  try {
    data = await adminApi<AssignmentPayload>(admin.login, `/assignments/${encodeURIComponent(slug)}`);
  } catch (error) {
    return <ErrorState error={error} />;
  }
  return (
    <div className="stack-lg">
      <AssignmentHeader slug={slug} title={data.assignment.title} status={data.assignment.status} tab="tests" role={admin.role} />
      <TestsManager initial={data} />
    </div>
  );
}
