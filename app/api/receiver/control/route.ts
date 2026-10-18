import { actorOf, recordAudit } from '@/lib/audit';
import { requireAdmin } from '@/lib/auth/session';
import { errorResponse, json, readJson } from '@/lib/http';
import { getRedis } from '@/lib/redis';
import { clearControl, getControl, listControls, setControl, DEFAULT_CONTROL_TTL } from '@/lib/control';
import { controlClearSchema, controlCommandSchema } from '@/schemas/control';
import type { ControlCommandType } from '@/types';

export const dynamic = 'force-dynamic';

const ACTION_OF: Record<ControlCommandType, 'control.kill' | 'control.pause' | 'control.resume'> = {
  KILL: 'control.kill',
  PAUSE: 'control.pause',
  RESUME: 'control.resume',
};

// GET /api/receiver/control?accountId=X&format=lua   -> teks biasa untuk polling Lua ("OK" jika kosong)
// GET /api/receiver/control                            -> JSON daftar perintah aktif (dashboard, sesi staf)
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const accountId = params.get('accountId') ?? '';
    const asLua = params.get('format') === 'lua';

    // Jalur Lua (executor polling): terbuka, baca perintah untuk accountId. Tanpa autentikasi karena
    // executor tidak memegang sesi dashboard; perintah sendiri diaktifkan staf dari dashboard.
    if (accountId) {
      const cmd = (await getControl(getRedis(), accountId)) ?? 'OK';
      if (asLua) {
        return new Response(cmd, {
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-store, max-age=0',
            'Vercel-CDN-Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
          },
        });
      }
      return json({ success: true, accountId, command: cmd });
    }

    // Jalur dashboard: sesi staf, daftar semua perintah aktif.
    const { denied } = await requireAdmin();
    if (denied) return denied;
    const controls = await listControls(getRedis());
    return json({ success: true, data: controls });
  } catch (err) {
    return errorResponse(err, 'receiver/control GET');
  }
}

// POST { accountId, command, ttlSeconds? } -> simpan perintah dengan TTL. Sesi staf.
export async function POST(request: Request) {
  try {
    const { session, denied } = await requireAdmin();
    if (denied) return denied;
    const parsed = controlCommandSchema.safeParse(await readJson(request, 1024));
    if (!parsed.success) return json({ success: false, message: parsed.error.issues[0]?.message ?? 'Data tidak valid' }, 400);
    const { accountId, command, ttlSeconds } = parsed.data;

    const redis = getRedis();
    const ttl = ttlSeconds ?? DEFAULT_CONTROL_TTL;
    const entry = await setControl(redis, accountId, command, session.sub, ttl);
    await recordAudit(redis, { ...actorOf(session, request.headers), action: ACTION_OF[command], target: accountId, detail: `ttl=${ttl}s` });
    return json({ success: true, data: entry });
  } catch (err) {
    return errorResponse(err, 'receiver/control POST');
  }
}

// DELETE { accountId } -> hapus perintah lebih awal. Sesi staf.
export async function DELETE(request: Request) {
  try {
    const { session, denied } = await requireAdmin();
    if (denied) return denied;
    const parsed = controlClearSchema.safeParse(await readJson(request, 1024));
    if (!parsed.success) return json({ success: false, message: parsed.error.issues[0]?.message ?? 'Data tidak valid' }, 400);
    const redis = getRedis();
    const removed = await clearControl(redis, parsed.data.accountId);
    await recordAudit(redis, { ...actorOf(session, request.headers), action: 'control.kill', target: parsed.data.accountId, detail: removed ? 'perintah dicabut' : 'tidak ada perintah aktif' });
    return json({ success: true, removed });
  } catch (err) {
    return errorResponse(err, 'receiver/control DELETE');
  }
}
