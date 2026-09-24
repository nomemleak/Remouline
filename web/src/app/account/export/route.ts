// "Download my data": everything stored about the logged-in user, as one JSON file.
import { NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { studentApi } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: 'not logged in' }, { status: 401 });
  const data = await studentApi(user.login, '/export');
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${user.login}-data.json"`,
      'Cache-Control': 'no-store',
    },
  });
}
