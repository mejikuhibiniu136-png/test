import { requireAdmin, requireSession } from '@/lib/auth/session';
import { createGame, listGames } from '@/lib/games';
import { errorResponse, json, readJson } from '@/lib/http';
import { getRedis } from '@/lib/redis';
import { createGameSchema } from '@/schemas/game';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { denied } = await requireSession();
    if (denied) return denied;
    return json({ success: true, data: await listGames(getRedis()) });
  } catch (err) {
    return errorResponse(err, 'games GET');
  }
}

// Admin: membuat tabel game secara manual.
export async function POST(request: Request) {
  try {
    const { session, denied } = await requireAdmin();
    if (denied) return denied;
    const parsed = createGameSchema.safeParse(await readJson(request, 1024));
    if (!parsed.success) return json({ success: false, message: parsed.error.issues[0]?.message ?? 'Nama tidak valid' }, 400);
    return json({ success: true, data: await createGame(getRedis(), parsed.data.name, session.sub) }, 201);
  } catch (err) {
    return errorResponse(err, 'games POST');
  }
}
