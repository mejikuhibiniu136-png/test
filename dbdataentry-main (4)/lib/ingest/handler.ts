// Penerima webhook universal. Alur satu request:
//   maintenance -> token opsional -> rate limit -> saklar receiver -> baca body (batas ukuran) ->
//   STAGING (/tmp, verifikasi utuh) -> parse JSON / URL-encoded / form-data / teks ->
//   deteksi game -> tulis atomik ke Upstash -> hapus file staging (selalu).
import { timingSafeEqual, createHash } from 'node:crypto';
import { drainQueue } from '@/lib/ingest/drain';
import { processIngest } from '@/lib/ingest/process';
import { buildItem, enqueue, queueLimits } from '@/lib/ingest/queue';
import { withStaging } from '@/lib/ingest/staging';
import { isReceiverEnabled } from '@/lib/ingest/store';
import { scheduleBackground } from '@/lib/background';
import { emitAlert } from '@/lib/notify/emit';
import { HttpError, errorResponse, getClientIp, json } from '@/lib/http';
import { KEYS, verifyHmacSignature } from '@/lib/keys';
import { maintenanceResponse } from '@/lib/maintenance';
import { hitRateLimit } from '@/lib/rateLimit';
import { getRedis, type RedisLike } from '@/lib/redis';
import { authenticateApiKey } from '@/lib/apikeys';
import { recordSecurityEvent } from '@/lib/securityStats';
import { readRuntimeSettings, readSecretSetting } from '@/lib/settings';

// Verifikasi HMAC-SHA256 opsional (header X-Webhook-Signature / X-Hub-Signature-256) terhadap
// WEBHOOK_SECRET yang Superadmin set di Pengaturan Sistem (tersimpan terenkripsi di Redis,
// didekripsi di sini). Tanpa secret yang dikonfigurasi, endpoint tetap terbuka seperti semula
// (kompatibel dengan klien lama, termasuk skrip Lua yang memakai WEBHOOK_INGEST_TOKEN).
async function verifyWebhookSignature(redis: RedisLike, headers: Headers, rawBody: Uint8Array): Promise<Response | null> {
  const secret = await readSecretSetting(redis, 'WEBHOOK_SECRET');
  if (!secret) return null;
  const signature = headers.get('x-webhook-signature') ?? headers.get('x-hub-signature-256');
  if (!verifyHmacSignature(rawBody, signature, secret)) {
    await recordSecurityEvent(redis, 'hmac_fail');
    return json({ success: false, message: 'Signature HMAC tidak valid' }, 401);
  }
  return null;
}

export const MAX_BODY_BYTES = 256 * 1024;
const RATE = { limit: 600, windowSeconds: 60 };

// Memicu pengurasan antrean setelah respons dikirim (satu pengurus pada satu waktu berkat kunci Redis).
// Cron /api/cron/ingest-drain adalah jaring pengaman bila tidak ada trafik yang memicunya.
const defaultScheduleDrain = async (redis: RedisLike): Promise<void> => {
  await scheduleBackground(() => drainQueue(redis, { budgetMs: 8000 }));
};

export interface IngestDeps {
  redis?: RedisLike;
  /** false = paksa jalur langsung walau mode antrean menyala (dipakai tes). */
  queue?: boolean;
  scheduleDrain?: (redis: RedisLike) => void | Promise<void>;
}

export interface IngestOptions {
  /** Game bila payload tidak memuat identitas (mis. alias lama /api/webhook -> Anime Dice). */
  defaultGame?: string;
  /** Perlakukan payload sebagai status akun (alias lama /api/receiver/account). */
  forceAccount?: boolean;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
};

export function withCors(res: Response): Response {
  for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v);
  return res;
}

export const preflight = () => withCors(new Response(null, { status: 204 }));

export const ingestInfo = () =>
  withCors(
    json({
      success: true,
      endpoint: 'universal webhook receiver',
      method: 'POST',
      accepts: ['application/json', 'application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain'],
      message: 'Kirim data dengan POST. Game/sumber dikenali dari game_name, game_id, source, dan kunci serupa.',
    })
  );

const sha = (s: string) => createHash('sha256').update(s).digest();

// Autentikasi receiver. Kredensial diterima dari header x-api-key, Authorization: Bearer, atau ?key=.
// Sah bila cocok dengan WEBHOOK_INGEST_TOKEN (env, opsional) atau API Key dashboard yang aktif.
// Wajib hanya jika WEBHOOK_INGEST_TOKEN diset ATAU Superadmin menyalakan "Wajibkan API Key";
// selain itu endpoint tetap terbuka (kompatibel dengan skrip Lua yang sudah terpasang).
// `keyId` terisi bila request memakai API Key dashboard: dipakai sebagai kunci rate limit.
async function authenticate(
  request: Request,
  redis: RedisLike,
  apiKeyRequired: boolean,
  env: Record<string, string | undefined> = process.env
): Promise<{ denied: Response | null; keyId: string | null }> {
  const expected = (env.WEBHOOK_INGEST_TOKEN ?? '').trim();
  const auth = request.headers.get('authorization') ?? '';
  const bearer = /^bearer\s+/i.test(auth) ? auth.replace(/^bearer\s+/i, '').trim() : '';
  let query = '';
  try {
    query = new URL(request.url).searchParams.get('key') ?? '';
  } catch {
    query = '';
  }
  const provided = request.headers.get('x-api-key') || bearer || query;

  if (provided && expected && timingSafeEqual(sha(provided), sha(expected))) return { denied: null, keyId: null };
  if (provided) {
    const key = await authenticateApiKey(redis, provided);
    if (key) return { denied: null, keyId: key.id };
  }
  if (!expected && !apiKeyRequired) return { denied: null, keyId: null };
  await recordSecurityEvent(redis, 'auth_fail');
  return { denied: json({ success: false, message: 'Unauthorized' }, 401), keyId: null };
}

// Membaca body dengan batas ukuran tanpa menampung seluruh stream lebih dulu.
async function readBodyBytes(request: Request, maxBytes: number): Promise<Uint8Array> {
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new HttpError(413, 'Payload terlalu besar');
      }
      chunks.push(value);
    }
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, 'Payload terpotong: koneksi terputus sebelum body selesai');
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

export async function handleIngest(
  request: Request,
  options: IngestOptions = {},
  deps: IngestDeps = {}
): Promise<Response> {
  const startedAt = Date.now();
  try {
    const redis = deps.redis ?? getRedis();
    const settings = await readRuntimeSettings(redis);

    // Maintenance menolak semua pengirim, termasuk yang membawa API Key valid. Dicek sebelum
    // autentikasi dan rate limit supaya tidak ada request yang menyentuh Redis atau menulis data.
    if (settings.maintenanceMode) return withCors(maintenanceResponse(settings.maintenanceMessage));

    const { denied, keyId } = await authenticate(request, redis, settings.apiKeyRequired);
    if (denied) return withCors(denied);

    // Pemakai API Key dihitung per key (adil untuk beberapa skrip di satu IP); selain itu per IP.
    const rateKey = keyId ? KEYS.rateLimit('ingest-key', keyId) : KEYS.rateLimit('ingest', getClientIp(request.headers));
    const rate = await hitRateLimit(redis, rateKey, { limit: settings.rateLimitPerMin, windowSeconds: RATE.windowSeconds });
    if (!rate.allowed) {
      await recordSecurityEvent(redis, 'rate_limited');
      return withCors(json({ success: false, message: 'Terlalu banyak request' }, 429, { 'Retry-After': String(rate.retryAfterSeconds) }));
    }

    if (!(await isReceiverEnabled(redis))) {
      return withCors(json({ success: true, stored: false, message: 'Receiver OFF, payload diabaikan' }, 202));
    }

    const declaredHeader = request.headers.get('content-length');
    const declared = declaredHeader !== null && /^\d+$/.test(declaredHeader) ? Number(declaredHeader) : null;
    if (declared !== null && declared > MAX_BODY_BYTES) throw new HttpError(413, 'Payload terlalu besar');

    const bytes = await readBodyBytes(request, MAX_BODY_BYTES);

    const badSignature = await verifyWebhookSignature(redis, request.headers, bytes);
    if (badSignature) return withCors(badSignature);

    const contentType = request.headers.get('content-type');
    const url = new URL(request.url);
    const query = url.searchParams;

    // Mode antrean (opsional, dinyalakan Superadmin): tulis cepat ke antrean, jawab 202, proses di latar.
    // Payload besar tetap diproses langsung agar antrean tidak menampung blob. Gagal mengantre karena
    // Redis bermasalah jatuh ke jalur langsung (yang akan gagal dengan 503 + Retry-After bila Redis memang mati).
    if (settings.ingestQueueEnabled && bytes.length <= queueLimits().maxItemBytes && (deps.queue ?? true)) {
      try {
        const item = buildItem({ bytes, contentType, headers: request.headers, url, defaultGame: options.defaultGame, forceAccount: options.forceAccount });
        const queued = await enqueue(redis, item);
        if (!queued.ok) {
          await emitAlert({ kind: 'queue.backlog', severity: 'critical', title: 'Antrean ingest penuh', message: 'Antrean mencapai batas kedalaman; request baru ditolak (503) sampai pemroses mengejar.', fields: [{ name: 'Batas', value: String(queueLimits().maxDepth) }], dedupeKey: 'full' }, { redis });
          throw new HttpError(503, 'Antrean penuh, coba kirim ulang', { 'Retry-After': '10' });
        }
        if (queued.depth >= queueLimits().alertDepth) {
          await emitAlert({ kind: 'queue.backlog', severity: 'warning', title: 'Antrean ingest menumpuk', message: `Kedalaman antrean ${queued.depth} melewati ambang peringatan.`, fields: [{ name: 'Kedalaman', value: String(queued.depth) }], dedupeKey: 'depth' }, { redis });
        }
        await (deps.scheduleDrain ?? defaultScheduleDrain)(redis);
        return withCors(json({ success: true, stored: false, queued: true, id: queued.id, depth: queued.depth, rttMs: Date.now() - startedAt }, 202));
      } catch (err) {
        if (err instanceof HttpError) throw err;
        console.error('[ingest] antrean tidak tersedia, memakai jalur langsung:', err instanceof Error ? err.message : err);
      }
    }

    const { value, staged } = await withStaging(bytes, { contentType, declaredLength: declared }, (verified) =>
      processIngest(redis, { verified, contentType, headers: request.headers, query, startedAt, defaultGame: options.defaultGame, forceAccount: options.forceAccount })
    );

    return withCors(json({ success: true, stored: true, staged, ...value, rttMs: Date.now() - startedAt }, 200));
  } catch (err) {
    return withCors(errorResponse(err, 'receiver/universal'));
  }
}
