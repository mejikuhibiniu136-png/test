import { requireSession } from '@/lib/auth/session';
import { clampInt, errorResponse, json } from '@/lib/http';
import { getRedis } from '@/lib/redis';
import { readLeaks } from '@/lib/hwid';

export const dynamic = 'force-dynamic';

// ?limit=1..500 — daftar kejadian kebocoran HWID (terbaru di depan). Sesi: siapa pun yang login.
export async function GET(request: Request) {
  try {
    const { denied } = await requireSession();
    if (denied) return denied;
    const limit = clampInt(new URL(request.url).searchParams.get('limit'), 1, 500, 100);
    const leaks = await readLeaks(getRedis(), limit);
    return json({ success: true, data: leaks });
  } catch (err) {
    return errorResponse(err, 'hwid/leaks GET');
  }
}
