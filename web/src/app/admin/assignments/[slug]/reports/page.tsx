import { requireStaff } from '@/lib/auth';
import { adminApi } from '@/lib/api';
import { ErrorState } from '@/components/ErrorState';
import { AssignmentHeader } from '../AssignmentHeader';
import { ReportsAdmin, type AdminReport } from './ReportsAdmin';

export const metadata = { title: 'Reports' };

export default async function ReportsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const admin = await requireStaff('maintainer');
  let data: { assignment: { title: string; status: string } };
  let reports: AdminReport[];
  try {
    [data, { reports }] = await Promise.all([
      adminApi<{ assignment: { title: string; status: string } }>(admin.login, `/assignments/${encodeURIComponent(slug)}`),
      adminApi<{ reports: AdminReport[] }>(admin.login, `/assignments/${encodeURIComponent(slug)}/reports`),
    ]);
  } catch (error) {
    return <ErrorState error={error} />;
  }
  return (
    <div className="stack-lg">
      <AssignmentHeader slug={slug} title={data.assignment.title} status={data.assignment.status} tab="reports" role={admin.role} />
      <ReportsAdmin slug={slug} reports={reports} />
    </div>
  );
}
