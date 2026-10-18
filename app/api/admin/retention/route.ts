import { actorOf, recordAudit } from '@/lib/audit';
import { requireSuperadmin } from '@/lib/auth/session';
import { HttpError, errorResponse, json } from '@/lib/http';
import { getRedis } from '@/lib/redis';
import { purgeOldLogs } from '@/lib/retention';
import { readSettings } from '@/lib/settings';

export const dynamic = 'force-dynamic';

// Superadmin: jalankan pembersihan retensi sekarang (memakai "Retensi log" yang tersimpan).
export async function POST(request: Request) {
  try {
    const { session, denied } = await requireSuperadmin();
    if (denied) return denied;
    const redis = getRedis();
    const { logRetentionDays } = await readSettings(redis);
    if (logRetentionDays <= 0) throw new HttpError(400, 'Retensi log nonaktif. Isi jumlah hari lebih dulu.');
    const result = await purgeOldLogs(redis, logRetentionDays);
    await recordAudit(redis, {
      ...actorOf(session, request.headers),
      action: 'retention.purge',
      detail: `log > ${logRetentionDays} hari: ${result.removed} dihapus dari ${result.keys} tabel`,
    });
    return json({ success: true, data: result });
  } catch (err) {
    return errorResponse(err, 'admin/retention POST');
  }
}
