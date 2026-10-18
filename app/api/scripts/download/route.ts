import { actorOf, recordAudit } from '@/lib/audit';
import { requireAdmin } from '@/lib/auth/session';
import { HttpError, errorResponse, json } from '@/lib/http';
import { getRedis } from '@/lib/redis';
import { bindHwid, issueWatermark, readBinding, readDownloadRecord } from '@/lib/hwid';
import { sealScript } from '@/lib/lua/scriptCrypto';
import { renderHwidScript } from '@/lib/hwid/scriptTemplate';
import { hwidDownloadSchema } from '@/schemas/hwid';

export const dynamic = 'force-dynamic';

// Origin dari domain yang sedang melayani (Vercel mengisi x-forwarded-host/proto).
function originOf(request: Request): string {
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  const proto = request.headers.get('x-forwarded-proto')?.split(',')[0].trim();
  if (host && /^[a-z0-9.-]+(:\d+)?$/i.test(host)) {
    return `${proto === 'http' ? 'http' : 'https'}://${host}`;
  }
  return new URL(request.url).origin;
}

// Jalur sesi (staf): ?accountId=&userId=&placeId= . Ikat HWID, bangkitkan watermark per-unduhan,
// kembalikan source Lua ber-watermark siap tempel ke executor.
async function downloadBySession(request: Request): Promise<Response> {
  const { session, denied } = await requireAdmin();
  if (denied) return denied;
  const params = new URL(request.url).searchParams;
  const parsed = hwidDownloadSchema.safeParse({
    accountId: params.get('accountId') ?? '',
    userId: params.get('userId') ?? undefined,
    placeId: params.get('placeId') ?? undefined,
  });
  if (!parsed.success) return json({ success: false, message: parsed.error.issues[0]?.message ?? 'Parameter tidak valid' }, 400);
  const { accountId, userId, placeId } = parsed.data;

  const redis = getRedis();
  let binding = await readBinding(redis, accountId);
  if (!binding) {
    if (userId === undefined || placeId === undefined) {
      throw new HttpError(400, 'Ikatan HWID belum ada. Sertakan userId dan placeId untuk mengikat pertama kali.');
    }
    binding = await bindHwid(redis, accountId, userId, placeId, session.sub);
    await recordAudit(redis, { ...actorOf(session, request.headers), action: 'hwid.bind', target: accountId, detail: `hwid=${binding.hwidHash} uid=${userId} pid=${placeId}` });
  }

  const origin = originOf(request);
  const { record, nonce, hex } = await issueWatermark(redis, binding, session.sub);
  const lua = renderHwidScript({
    endpoint: `${origin}/api/receiver/universal`,
    leakUrl: `${origin}/api/hwid/report`,
    controlUrl: `${origin}/api/receiver/control`,
    accountId,
    nonce,
    hex,
    key: record.key,
  });
  return scriptResponse(lua, record.id);
}

// Jalur token (?token=<downloadId>): terbuka, divalidasi terhadap rekaman di Redis. Memungkinkan
// executor mengambil ulang skrip ber-watermark tanpa cookie dashboard. Rekaman ber-TTL.
async function downloadByToken(request: Request): Promise<Response> {
  const token = new URL(request.url).searchParams.get('token') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(token)) return json({ success: false, message: 'Token tidak valid' }, 400);
  const redis = getRedis();
  const record = await readDownloadRecord(redis, token);
  if (!record) return json({ success: false, message: 'Token kedaluwarsa atau tidak dikenal' }, 410);
  const binding = await readBinding(redis, record.accountId);
  if (!binding) return json({ success: false, message: 'Ikatan HWID telah dihapus' }, 410);

  // Segel ulang dengan kunci yang sama (nonce baru per pengambilan — ciphertext selalu berbeda).
  const payload = JSON.stringify({
    accountId: binding.accountId, userId: binding.userId, placeId: binding.placeId,
    hwidHash: binding.hwidHash, issuedAt: record.issuedAt, downloadId: record.id,
  });
  const { nonce, hex } = sealScript(payload, record.key);
  const origin = originOf(request);
  const lua = renderHwidScript({
    endpoint: `${origin}/api/receiver/universal`,
    leakUrl: `${origin}/api/hwid/report`,
    controlUrl: `${origin}/api/receiver/control`,
    accountId: record.accountId,
    nonce,
    hex,
    key: record.key,
  });
  return scriptResponse(lua, record.id);
}

function scriptResponse(lua: string, downloadId: string): Response {
  return new Response(lua, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      // Tanpa cache: watermark & kunci acak baru tiap unduhan (jalur sesi); jalur token nonce baru.
      'Cache-Control': 'no-store, max-age=0',
      'CDN-Cache-Control': 'no-store',
      'Vercel-CDN-Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Download-Id': downloadId,
    },
  });
}

// GET /api/scripts/download?accountId=&userId=&placeId=  (sesi staf)
// GET /api/scripts/download?token=<downloadId>           (executor, terbuka)
export async function GET(request: Request) {
  try {
    if (new URL(request.url).searchParams.get('token')) return await downloadByToken(request);
    return await downloadBySession(request);
  } catch (err) {
    return errorResponse(err, 'scripts/download GET');
  }
}
