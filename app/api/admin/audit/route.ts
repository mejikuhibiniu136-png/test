import { readAudit } from '@/lib/audit';
import { requireSuperadmin } from '@/lib/auth/session';
import { clampInt, errorResponse, json } from '@/lib/http';
import { getRedis } from '@/lib/redis';

export const dynamic = 'force-dynamic';

// Superadmin: jejak audit terbaru. ?limit=1..200 (bawaan 50)
export async function GET(request: Request) {
  try {
    const { denied } = await requireSuperadmin();
    if (denied) return denied;
    const limit = clampInt(new URL(request.url).searchParams.get('limit'), 1, 200, 50);
    return json({ success: true, data: await readAudit(getRedis(), limit) });
  } catch (err) {
    return errorResponse(err, 'admin/audit GET');
  }
}
