import { actorOf, recordAudit } from '@/lib/audit';
import { drainQueue } from '@/lib/ingest/drain';
import { purgeDead, queueLimits, readQueueStats, retryDead } from '@/lib/ingest/queue';
import { HttpError, errorResponse, json, readJson } from '@/lib/http';
import { requirePermission } from '@/lib/rbac/guard';
import { getRedis } from '@/lib/redis';
import { readSettings } from '@/lib/settings';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function view(redis = getRedis()) {
  const [stats, settings] = await Promise.all([readQueueStats(redis), readSettings(redis)]);
  const { maxDepth, maxItemBytes, maxAttempts, leaseMs } = queueLimits();
  return { success: true, enabled: settings.ingestQueueEnabled, stats, limits: { maxDepth, maxItemBytes, maxAttempts, leaseSeconds: leaseMs / 1000 } };
}

// Moderator ke atas: lihat kedalaman, pemrosesan, dead-letter.
export async function GET() {
  try {
    const { denied } = await requirePermission('queue:read');
    if (denied) return denied;
    return json(await view());
  } catch (err) {
    return errorResponse(err, 'admin/queue GET');
  }
}

// Super Admin: kuras sekarang, ulangi dead-letter, atau kosongkan dead-letter.
export async function POST(request: Request) {
  try {
    const { session, denied } = await requirePermission('queue:manage');
    if (denied) return denied;
    const body = await readJson(request, 512);
    const action = String(body.action ?? '');
    const redis = getRedis();
    let detail: string;
    if (action === 'drain') {
      const r = await drainQueue(redis, { budgetMs: 25_000 });
      if (!r.locked) throw new HttpError(409, 'Pengurus lain sedang menguras antrean. Coba lagi sebentar.');
      detail = `diproses ${r.processed}, gagal ${r.failed}, dead ${r.dead}, dipulihkan ${r.reclaimed}`;
    } else if (action === 'retry-dead') {
      detail = `${await retryDead(redis)} item dikembalikan ke antrean`;
    } else if (action === 'purge-dead') {
      detail = `${await purgeDead(redis)} item dead-letter dihapus`;
    } else {
      throw new HttpError(400, 'Aksi tidak dikenal');
    }
    await recordAudit(redis, { ...actorOf(session, request.headers), action: 'queue.drain', target: action, detail });
    return json({ ...(await view(redis)), message: detail });
  } catch (err) {
    return errorResponse(err, 'admin/queue POST');
  }
}
