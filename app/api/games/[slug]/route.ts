import { actorOf, recordAudit } from '@/lib/audit';
import { requireAdmin } from '@/lib/auth/session';
import { deleteGame, renameGame } from '@/lib/games';
import { errorResponse, json, readJson } from '@/lib/http';
import { getRedis } from '@/lib/redis';
import { renameGameSchema } from '@/schemas/game';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ slug: string }> };
const SLUG = /^[a-z0-9-]{1,64}$/;

// Admin: mengubah nama tabel (data log ikut dipindahkan).
export async function PATCH(request: Request, { params }: Ctx) {
  try {
    const { session, denied } = await requireAdmin();
    if (denied) return denied;
    const { slug } = await params;
    if (!SLUG.test(slug)) return json({ success: false, message: 'Slug tidak valid' }, 400);
    const parsed = renameGameSchema.safeParse(await readJson(request, 1024));
    if (!parsed.success) return json({ success: false, message: parsed.error.issues[0]?.message ?? 'Nama tidak valid' }, 400);
    const redis = getRedis();
    const data = await renameGame(redis, slug, parsed.data.name);
    await recordAudit(redis, { ...actorOf(session, request.headers), action: 'game.rename', target: slug, detail: `nama baru: ${parsed.data.name}` });
    return json({ success: true, data });
  } catch (err) {
    return errorResponse(err, 'games PATCH');
  }
}

// Admin: menghapus tabel beserta seluruh lognya.
export async function DELETE(request: Request, { params }: Ctx) {
  try {
    const { session, denied } = await requireAdmin();
    if (denied) return denied;
    const { slug } = await params;
    if (!SLUG.test(slug)) return json({ success: false, message: 'Slug tidak valid' }, 400);
    const redis = getRedis();
    await deleteGame(redis, slug);
    await recordAudit(redis, { ...actorOf(session, request.headers), action: 'game.delete', target: slug });
    return json({ success: true });
  } catch (err) {
    return errorResponse(err, 'games DELETE');
  }
}
