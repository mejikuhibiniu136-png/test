import { recordAudit } from '@/lib/audit';
import { checkCron } from '@/lib/cronAuth';
import { errorResponse, json } from '@/lib/http';
import { getRedis } from '@/lib/redis';
import { purgeOldLogs } from '@/lib/retention';
import { readSettings } from '@/lib/settings';

export const dynamic = 'force-dynamic';

// Dipanggil Vercel Cron (vercel.json) tiap hari. Tanpa sesi dashboard: dijaga CRON_SECRET, yang
// otomatis dikirim Vercel sebagai "Authorization: Bearer <CRON_SECRET>". CRON_SECRET kosong = ditolak.
export async function GET(request: Request) {
  try {
    const denied = checkCron(request);
    if (denied) return denied;

    const redis = getRedis();
    const { logRetentionDays } = await readSettings(redis);
    if (logRetentionDays <= 0) return json({ success: true, skipped: true, message: 'Retensi log nonaktif' });
    const result = await purgeOldLogs(redis, logRetentionDays);
    if (result.removed > 0) {
      await recordAudit(redis, { actor: 'cron', role: 'system', action: 'retention.purge', detail: `log > ${logRetentionDays} hari: ${result.removed} dihapus dari ${result.keys} tabel` });
    }
    return json({ success: true, data: result });
  } catch (err) {
    return errorResponse(err, 'cron/retention');
  }
}
