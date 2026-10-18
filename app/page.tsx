import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { WELCOME_COOKIE } from '@/components/onboarding/constants';
import { OnboardingGate } from '@/components/onboarding/OnboardingGate';
import { getSession } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export default async function Home() {
  // proxy.ts sudah mengarahkan tamu ke /login dan akun belum aktif ke /pending-approval;
  // pemeriksaan ini lapisan kedua.
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role !== 'superadmin' && session.status !== 'active') redirect('/pending-approval');
  const welcomeSeen = (await cookies()).get(WELCOME_COOKIE)?.value === '1';
  return <OnboardingGate username={session.sub} role={session.role} welcomeSeen={welcomeSeen} />;
}
