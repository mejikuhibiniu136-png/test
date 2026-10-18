import { errorResponse, json } from '@/lib/http';
import { clampInt } from '@/lib/http';
import { parseBound, searchLogs } from '@/lib/logSearch';
import { requirePermission } from '@/lib/rbac/guard';
import { getRedis } from '@/lib/redis';

export const dynamic = 'force-dynamic';

const SLUG = /^[a-z0-9-]{1,64}$/;

// GET /api/logs/search?game=<slug|all>&q=<kueri>&from=<ISO|YYYY-MM-DD>&to=<ISO|YYYY-MM-DD>&limit=1..200&cursor=<opaque>
export async function GET(request: Request) {
  try {
    const { denied } = await requirePermission('logs:search');
    if (denied) return denied;
    const p = new URL(request.url).searchParams;
    const game = p.get('game') ?? 'all';
    if (game !== 'all' && !SLUG.test(game)) return json({ success: false, message: 'Parameter game tidak valid' }, 400);
    const from = parseBound(p.get('from'), 'from');
    const to = parseBound(p.get('to'), 'to');
    if (from === 'invalid' || to === 'invalid') return json({ success: false, message: 'Format tanggal tidak valid (gunakan YYYY-MM-DD atau ISO-8601)' }, 400);
    if (from && to && from > to) return json({ success: false, message: 'Tanggal awal harus sebelum tanggal akhir' }, 400);
    const result = await searchLogs(getRedis(), game, { q: p.get('q') ?? '', from: from ?? undefined, to: to ?? undefined }, { limit: clampInt(p.get('limit'), 1, 200, 50), cursor: p.get('cursor') });
    return json({ success: true, ...result });
  } catch (err) {
    return errorResponse(err, 'logs/search GET');
  }
}
