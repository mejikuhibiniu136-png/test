import { requireAdmin } from '@/lib/auth/session';
import { errorResponse, json } from '@/lib/http';
import { getRedis } from '@/lib/redis';
import { readDevices, userKey } from '@/lib/users';

export const dynamic = 'force-dynamic';

// Riwayat perangkat, browser, IP, dan lokasi login satu pengguna (maks 50 terakhir).
export async function GET(_request: Request, { params }: { params: Promise<{ username: string }> }) {
  try {
    const { denied } = await requireAdmin();
    if (denied) return denied;
    const { username } = await params;
    const key = userKey(decodeURIComponent(username));
    if (!/^[a-z0-9_.-]{1,64}$/.test(key)) return json({ success: false, message: 'Username tidak valid' }, 400);
    return json({ success: true, data: await readDevices(getRedis(), key) });
  } catch (err) {
    return errorResponse(err, 'admin/users devices');
  }
}
