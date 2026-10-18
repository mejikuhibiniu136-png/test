// Antrean pesan untuk ingest (at-least-once) di atas Redis, aman untuk serverless.
//
//   produser:  LPUSH q:ingest:pending     (O(1), dijawab 202 segera, ada batas kedalaman = backpressure)
//   konsumen:  CLAIM  pending -> inflight (ZSET: item -> waktu lease habis), atomik dalam satu EVAL
//              proses  -> ACK (ZREM) bila sukses
//                      -> NACK bila gagal: kembali ke pending (attempts+1) atau ke dead-letter
//   pemulih:   RECLAIM item yang lease-nya habis (fungsi mati di tengah jalan) kembali ke pending
//
// Semua perpindahan antar struktur dilakukan di dalam script Lua, jadi item tidak pernah berada di
// dua tempat sekaligus maupun hilang di antaranya. Semantik pengiriman: at-least-once. Duplikat
// mungkin terjadi hanya bila konsumen mati SETELAH menulis tetapi SEBELUM ACK; untuk log itu berarti
// satu entri ganda, dan untuk status akun idempotent (rev + CAS).
import { randomUUID } from 'node:crypto';
import { envInt } from '@/lib/env';
import { KEYS } from '@/lib/keys';
import type { RedisLike } from '@/lib/redis';

export const QUEUE_VERSION = 1;
export const FORWARDED_HEADERS = ['x-game-name', 'x-game', 'x-source', 'x-webhook-source', 'x-github-event', 'x-event-type'] as const;

export interface QueueItem {
  v: number;
  id: string;
  enqueuedAt: number;
  attempts: number;
  contentType: string | null;
  bodyB64: string;
  headers: Record<string, string>;
  /** Query string asli (tanpa '?'), dipakai deteksi game. Rahasia ?key= dibuang sebelum diantre. */
  query: string;
  defaultGame?: string;
  forceAccount?: boolean;
}

export const queueLimits = () => ({
  maxDepth: envInt('QUEUE_MAX_DEPTH', 5000, 100, 100_000),
  maxItemBytes: envInt('QUEUE_MAX_ITEM_BYTES', 24 * 1024, 1024, 128 * 1024),
  leaseMs: envInt('QUEUE_LEASE_SECONDS', 60, 10, 600) * 1000,
  maxAttempts: envInt('QUEUE_MAX_ATTEMPTS', 5, 1, 20),
  alertDepth: envInt('QUEUE_ALERT_DEPTH', 2000, 10, 100_000),
});

// ---------- Script Lua ----------

const ENQUEUE = `
if redis.call('LLEN', KEYS[1]) >= tonumber(ARGV[2]) then
  redis.call('HINCRBY', KEYS[2], 'rejected', 1)
  return -1
end
local depth = redis.call('LPUSH', KEYS[1], ARGV[1])
redis.call('HINCRBY', KEYS[2], 'enqueued', 1)
return depth
`;

const CLAIM = `
local out = {}
local expiry = tonumber(ARGV[2]) + tonumber(ARGV[3])
for i = 1, tonumber(ARGV[1]) do
  local v = redis.call('RPOP', KEYS[1])
  if not v then break end
  redis.call('ZADD', KEYS[2], expiry, v)
  out[#out + 1] = v
end
return out
`;

// Bagian bersama NACK dan RECLAIM: kembalikan ke pending (attempts+1) atau pindahkan ke dead-letter.
const REQUEUE_FN = `
local function requeue(pending, dead, stats, raw, maxAttempts)
  local ok, obj = pcall(cjson.decode, raw)
  if not (ok and type(obj) == 'table') then
    redis.call('LPUSH', dead, raw)
    redis.call('HINCRBY', stats, 'dead', 1)
    return 'dead'
  end
  obj.attempts = (tonumber(obj.attempts) or 0) + 1
  if obj.attempts >= maxAttempts then
    redis.call('LPUSH', dead, cjson.encode(obj))
    redis.call('HINCRBY', stats, 'dead', 1)
    return 'dead'
  end
  redis.call('LPUSH', pending, cjson.encode(obj))
  redis.call('HINCRBY', stats, 'retried', 1)
  return 'retry'
end
`;

const ACK = `
local n = 0
for i = 1, #ARGV do n = n + redis.call('ZREM', KEYS[1], ARGV[i]) end
if n > 0 then redis.call('HINCRBY', KEYS[2], 'processed', n) end
return n
`;

const NACK = `${REQUEUE_FN}
if redis.call('ZREM', KEYS[2], ARGV[1]) == 0 then return 'gone' end
return requeue(KEYS[1], KEYS[3], KEYS[4], ARGV[1], tonumber(ARGV[2]))
`;

const RECLAIM = `${REQUEUE_FN}
local expired = redis.call('ZRANGEBYSCORE', KEYS[2], '-inf', ARGV[1], 'LIMIT', 0, 200)
local retried, dead = 0, 0
for _, raw in ipairs(expired) do
  if redis.call('ZREM', KEYS[2], raw) == 1 then
    if requeue(KEYS[1], KEYS[3], KEYS[4], raw, tonumber(ARGV[2])) == 'dead' then dead = dead + 1 else retried = retried + 1 end
  end
end
return {retried, dead}
`;

const UNLOCK = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0`;

// ---------- Produser ----------

export function buildItem(input: { bytes: Uint8Array; contentType: string | null; headers: Headers; url: URL; defaultGame?: string; forceAccount?: boolean }, nowMs = Date.now()): QueueItem {
  const headers: Record<string, string> = {};
  for (const h of FORWARDED_HEADERS) {
    const v = input.headers.get(h);
    if (v) headers[h] = v.slice(0, 200);
  }
  const q = new URLSearchParams(input.url.search);
  q.delete('key'); // kredensial tidak boleh ikut tersimpan di antrean
  return {
    v: QUEUE_VERSION, id: randomUUID(), enqueuedAt: nowMs, attempts: 0, contentType: input.contentType,
    bodyB64: Buffer.from(input.bytes).toString('base64'), headers, query: q.toString(),
    defaultGame: input.defaultGame, forceAccount: input.forceAccount,
  };
}

export type EnqueueResult = { ok: true; id: string; depth: number } | { ok: false; reason: 'full' };

export async function enqueue(redis: RedisLike, item: QueueItem, maxDepth = queueLimits().maxDepth): Promise<EnqueueResult> {
  const depth = Number(await redis.eval(ENQUEUE, [KEYS.queuePending, KEYS.queueStats], [JSON.stringify(item), String(maxDepth)]));
  return depth < 0 ? { ok: false, reason: 'full' } : { ok: true, id: item.id, depth };
}

// ---------- Konsumen ----------

export const claim = async (redis: RedisLike, n: number, nowMs = Date.now(), leaseMs = queueLimits().leaseMs): Promise<string[]> =>
  ((await redis.eval(CLAIM, [KEYS.queuePending, KEYS.queueInflight], [String(n), String(nowMs), String(leaseMs)])) as string[] | null) ?? [];

export const ack = async (redis: RedisLike, raws: string[]): Promise<number> =>
  raws.length ? Number(await redis.eval(ACK, [KEYS.queueInflight, KEYS.queueStats], raws)) : 0;

export const nack = async (redis: RedisLike, raw: string, maxAttempts = queueLimits().maxAttempts): Promise<'retry' | 'dead' | 'gone'> =>
  String(await redis.eval(NACK, [KEYS.queuePending, KEYS.queueInflight, KEYS.queueDead, KEYS.queueStats], [raw, String(maxAttempts)])) as 'retry' | 'dead' | 'gone';

export async function reclaimExpired(redis: RedisLike, nowMs = Date.now(), maxAttempts = queueLimits().maxAttempts): Promise<{ retried: number; dead: number }> {
  const r = (await redis.eval(RECLAIM, [KEYS.queuePending, KEYS.queueInflight, KEYS.queueDead, KEYS.queueStats], [String(nowMs), String(maxAttempts)])) as number[];
  return { retried: Number(r?.[0] ?? 0), dead: Number(r?.[1] ?? 0) };
}

export async function acquireLock(redis: RedisLike, ttlSeconds: number): Promise<string | null> {
  const token = randomUUID();
  return (await redis.set(KEYS.queueLock, token, { nx: true, ex: ttlSeconds })) ? token : null;
}
export const releaseLock = (redis: RedisLike, token: string) => redis.eval(UNLOCK, [KEYS.queueLock], [token]);

// ---------- Observabilitas & operasi ----------

export interface QueueStats {
  depth: number;
  inflight: number;
  dead: number;
  enqueued: number;
  processed: number;
  retried: number;
  failedPermanently: number;
  rejected: number;
  oldestAgeMs: number | null;
}

export async function readQueueStats(redis: RedisLike, nowMs = Date.now()): Promise<QueueStats> {
  const [depth, inflight, dead, stats, tail] = await Promise.all([
    redis.llen(KEYS.queuePending), redis.zcard(KEYS.queueInflight), redis.llen(KEYS.queueDead), redis.hgetall(KEYS.queueStats), redis.lrange(KEYS.queuePending, -1, -1),
  ]);
  let oldest: number | null = null;
  try { const t = tail?.[0]; const o = typeof t === 'string' ? JSON.parse(t) : t; if (o && typeof o.enqueuedAt === 'number') oldest = Math.max(0, nowMs - o.enqueuedAt); } catch { oldest = null; }
  const n = (k: string) => Number(stats?.[k] ?? 0) || 0;
  return { depth: Number(depth), inflight: Number(inflight), dead: Number(dead), enqueued: n('enqueued'), processed: n('processed'), retried: n('retried'), failedPermanently: n('dead'), rejected: n('rejected'), oldestAgeMs: oldest };
}

const REQUEUE_DEAD = `
local n = 0
for i = 1, tonumber(ARGV[1]) do
  local v = redis.call('RPOP', KEYS[1])
  if not v then break end
  local ok, obj = pcall(cjson.decode, v)
  if ok and type(obj) == 'table' then obj.attempts = 0; v = cjson.encode(obj) end
  redis.call('LPUSH', KEYS[2], v)
  n = n + 1
end
return n
`;
export const retryDead = async (redis: RedisLike, max = 500): Promise<number> => Number(await redis.eval(REQUEUE_DEAD, [KEYS.queueDead, KEYS.queuePending], [String(max)]));
export const purgeDead = async (redis: RedisLike): Promise<number> => { const n = Number(await redis.llen(KEYS.queueDead)); await redis.del(KEYS.queueDead); return n; };
