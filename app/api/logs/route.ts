import { actorOf, recordAudit } from '@/lib/audit';
import { requireAdmin, requireSession } from '@/lib/auth/session';
import { clearLogs } from '@/lib/games';
import { readLogs } from '@/lib/ingest/store';
import { clampInt, errorResponse, json } from '@/lib/http';
import { getRedis } from '@/lib/redis';

export const dynamic = 'force-dynamic';

const SLUG = /^[a-z0-9-]{1,64}$/;

// ?game=<slug>|all &limit=1..500
export async function GET(request: Request) {
  try {
    const { denied } = await requireSession();
    if (denied) return denied;
    const params = new URL(request.url).searchParams;
    const game = params.get('game') ?? 'all';
    if (game !== 'all' && !SLUG.test(game)) return json({ success: false, message: 'Parameter game tidak valid' }, 400);
    const data = await readLogs(getRedis(), game, clampInt(params.get('limit'), 1, 500, 100));
    return json({ success: true, data });
  } catch (err) {
    return errorResponse(err, 'logs GET');
  }
}

// Admin: Clear Logs. ?game=<slug> menghapus satu tabel; tanpa parameter / game=all menghapus semua log.
// Hanya key log yang dihapus. Data registrasi, perangkat, dan daftar akun tidak tersentuh.
export async function DELETE(request: Request) {
  try {
    const { session, denied } = await requireAdmin();
    if (denied) return denied;
    const game = new URL(request.url).searchParams.get('game') ?? 'all';
    if (game !== 'all' && !SLUG.test(game)) return json({ success: false, message: 'Parameter game tidak valid' }, 400);
    const redis = getRedis();
    const removed = await clearLogs(redis, game === 'all' ? 'all' : { game });
    await recordAudit(redis, { ...actorOf(session, request.headers), action: 'logs.clear', target: game, detail: `${removed} key log dihapus` });
    return json({ success: true, removedKeys: removed });
  } catch (err) {
    return errorResponse(err, 'logs DELETE');
  }
}
