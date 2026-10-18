import { cookies } from 'next/headers';
import { SESSION_COOKIE } from '@/lib/auth/jwt';
import { getSession } from '@/lib/auth/session';
import { json } from '@/lib/http';
import { getRedis } from '@/lib/redis';
import { revokeSession } from '@/lib/sessions';

export const dynamic = 'force-dynamic';

export async function POST() {
  // Token dicabut di server, bukan hanya cookie-nya dihapus: JWT yang sempat tercuri tidak berlaku lagi.
  try {
    const session = await getSession();
    if (session?.sid) await revokeSession(getRedis(), session.sub, session.sid);
  } catch (err) {
    console.error('[logout] pencabutan sesi gagal:', err instanceof Error ? err.message : err);
  }
  (await cookies()).delete(SESSION_COOKIE);
  return json({ success: true });
}
