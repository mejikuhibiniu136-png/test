import { redirect } from 'next/navigation';
import { WelcomeScreen } from '@/components/welcome/WelcomeScreen';
import { getSession } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export default async function WelcomePage() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role !== 'superadmin' && session.status !== 'active') redirect('/pending-approval');
  return <WelcomeScreen username={session.sub} />;
}
