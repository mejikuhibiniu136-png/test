import { requireSession } from '@/lib/auth/session';
import { errorResponse, json } from '@/lib/http';
import { EXPORT_MIME, exportStream, parseBound, type ExportFormat } from '@/lib/logSearch';
import { getRedis } from '@/lib/redis';

export const dynamic = 'force-dynamic';

const SLUG = /^[a-z0-9-]{1,64}$/;

// Ekspor PENUH dari server dan streaming (memori dibatasi ukuran potongan, bukan jumlah log).
// ?game=<slug>|all &format=csv|json|ndjson  &q=<kueri pencarian> &from=&to=  (filter sama dengan /api/logs/search)
export async function GET(request: Request) {
  try {
    const { denied } = await requireSession();
    if (denied) return denied;
    const params = new URL(request.url).searchParams;
    const game = params.get('game') ?? 'all';
    if (game !== 'all' && !SLUG.test(game)) return json({ success: false, message: 'Parameter game tidak valid' }, 400);
    const f = params.get('format');
    const format: ExportFormat = f === 'json' ? 'json' : f === 'ndjson' ? 'ndjson' : 'csv';
    const from = parseBound(params.get('from'), 'from');
    const to = parseBound(params.get('to'), 'to');
    if (from === 'invalid' || to === 'invalid') return json({ success: false, message: 'Format tanggal tidak valid' }, 400);

    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    return new Response(exportStream(getRedis(), game, { q: params.get('q') ?? '', from: from ?? undefined, to: to ?? undefined }, format), {
      headers: {
        'Content-Type': EXPORT_MIME[format],
        'Content-Disposition': `attachment; filename="logs-${game}-${stamp}.${format}"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err) {
    return errorResponse(err, 'logs/export GET');
  }
}
