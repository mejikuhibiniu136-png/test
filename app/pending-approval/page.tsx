import { redirect } from 'next/navigation';
import { PendingApprovalCard } from '@/components/forms/PendingApprovalCard';
import { getSession } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Menunggu Persetujuan · dbdataentry' };

export default async function PendingApprovalPage() {
  // proxy.ts sudah menangani redirect; ini lapisan kedua (konsisten dengan app/page.tsx).
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role === 'superadmin' || session.status === 'active') redirect('/');
  return <PendingApprovalCard username={session.sub} status={session.status} />;
}
