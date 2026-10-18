// Penulisan atomik ke Redis untuk satu event masuk.
//
// Satu EVAL menulis sekaligus: status akun (compare-and-set), logs:stream, game:<slug>:logs,
// metadata + penghitung tabel (dibuat otomatis jika baru), dan penanda perubahan untuk SSE.
// Karena script berjalan atomik di server Redis, tidak ada kondisi setengah tertulis:
// log tidak mungkin masuk tanpa tabelnya, dan tidak ada lost update pada akun.
import { envInt } from '@/lib/env';
import { KEYS } from '@/lib/keys';
import { parseStored } from '@/lib/http';
import type { ResolvedGame } from '@/lib/games';
import type { RedisLike } from '@/lib/redis';
import type { LogEntry, TrackedAccount } from '@/types';

export const INGEST_SCRIPT = `
if ARGV[1] ~= '' then
  local cur = redis.call('HGET', KEYS[1], ARGV[1])
  local rev = -1
  if cur then
    local ok, obj = pcall(cjson.decode, cur)
    rev = (ok and type(obj) == 'table' and tonumber(obj.rev)) or 0
  end
  if ARGV[2] ~= '-2' and rev ~= tonumber(ARGV[2]) then
    return 0
  end
  redis.call('HSET', KEYS[1], ARGV[1], ARGV[3])
end
if ARGV[4] ~= '' then
  redis.call('LPUSH', KEYS[2], ARGV[4])
  redis.call('LTRIM', KEYS[2], 0, tonumber(ARGV[5]) - 1)
  redis.call('LPUSH', KEYS[3], ARGV[4])
  redis.call('LTRIM', KEYS[3], 0, tonumber(ARGV[6]) - 1)
  redis.call('HSETNX', KEYS[4], ARGV[7], ARGV[8])
  redis.call('HINCRBY', KEYS[5], ARGV[7], 1)
end
redis.call('INCR', KEYS[6])
return 1
`;

export const MAX_CAS_RETRIES = 6;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const limits = () => ({
  stream: envInt('LOG_MAX_STREAM', 500, 50, 5000),
  perGame: envInt('LOG_MAX_PER_TABLE', 500, 50, 5000),
});

async function run(
  redis: RedisLike,
  game: ResolvedGame,
  args: { username: string; expectedRev: string; account: string; log: LogEntry | null }
): Promise<boolean> {
  const { stream, perGame } = limits();
  const result = await redis.eval(
    INGEST_SCRIPT,
    [KEYS.trackerAccounts, KEYS.streamLogs, KEYS.gameLogs(game.slug), KEYS.gamesMeta, KEYS.gamesCounts, KEYS.streamSeq],
    [
      args.username,
      args.expectedRev,
      args.account,
      args.log ? JSON.stringify(args.log) : '',
      String(stream),
      String(perGame),
      game.slug,
      game.metaJson,
    ]
  );
  return Number(result) === 1;
}

// Hanya log (webhook pihak ketiga): tanpa baca-ubah-tulis, jadi tidak ada balapan.
export async function writeLogOnly(redis: RedisLike, game: ResolvedGame, log: LogEntry): Promise<void> {
  await run(redis, game, { username: '', expectedRev: '-2', account: '', log });
}

export interface AccountWrite {
  account: TrackedAccount;
  log: LogEntry | null;
}

// Akun + (opsional) log. `build(existing)` dipanggil ulang tiap percobaan. Yang kalah balapan
// membaca ulang dan mencoba lagi; percobaan terakhir menulis tanpa syarat agar data tidak dibuang.
export async function writeAccountAndLog(
  redis: RedisLike,
  game: ResolvedGame,
  username: string,
  build: (existing: TrackedAccount | null) => AccountWrite
): Promise<AccountWrite & { attempts: number }> {
  for (let attempt = 0; attempt <= MAX_CAS_RETRIES; attempt += 1) {
    const existing = parseStored<TrackedAccount>(await redis.hget(KEYS.trackerAccounts, username));
    const expectedRev = existing ? Number(existing.rev) || 0 : -1;
    const built = build(existing);
    const force = attempt === MAX_CAS_RETRIES;

    const ok = await run(redis, game, {
      username,
      expectedRev: force ? '-2' : String(expectedRev),
      account: JSON.stringify(built.account),
      log: built.log,
    });
    if (ok) return { ...built, attempts: attempt + 1 };
    await sleep(5 + Math.random() * 25 * (attempt + 1));
  }
  throw new Error('writeAccountAndLog: tidak mungkin tercapai');
}

// ---------- Akun yang dilacak ----------

export async function readAccounts(redis: RedisLike): Promise<TrackedAccount[]> {
  const raw = await redis.hgetall(KEYS.trackerAccounts);
  if (!raw) return [];
  return Object.values(raw)
    .map((v) => parseStored<TrackedAccount>(v))
    .filter((a): a is TrackedAccount => a !== null && typeof a.username === 'string')
    .sort((a, b) => a.username.toLowerCase().localeCompare(b.username.toLowerCase()));
}

export async function deleteAccount(redis: RedisLike, username: string): Promise<boolean> {
  const removed = await redis.hdel(KEYS.trackerAccounts, username);
  if (Number(removed) > 0) await redis.incr(KEYS.streamSeq);
  return Number(removed) > 0;
}

// ---------- Baca log ----------

export async function readLogs(redis: RedisLike, slug: string | 'all', limit: number): Promise<LogEntry[]> {
  const key = slug === 'all' ? KEYS.streamLogs : KEYS.gameLogs(slug);
  const raw = await redis.lrange(key, 0, Math.max(1, limit) - 1);
  return (raw ?? []).map((r) => parseStored<LogEntry>(r)).filter((l): l is LogEntry => l !== null);
}

// ---------- Saklar receiver ----------

const STATUS_CACHE_MS = 5000;
let statusCache = { loaded: false, value: true, at: 0 };

export function parseEnabled(raw: unknown): boolean {
  if (raw === null || raw === undefined) return true; // default aktif
  if (typeof raw === 'string') return !['false', '0', 'off', ''].includes(raw.trim().toLowerCase());
  if (raw === 0) return false;
  return Boolean(raw);
}

export const readReceiverEnabled = async (redis: RedisLike) => parseEnabled(await redis.get(KEYS.receiverEnabled));

export async function isReceiverEnabled(redis: RedisLike, nowMs = Date.now()): Promise<boolean> {
  if (statusCache.loaded && nowMs - statusCache.at < STATUS_CACHE_MS) return statusCache.value;
  try {
    const value = await readReceiverEnabled(redis);
    statusCache = { loaded: true, value, at: nowMs };
    return value;
  } catch (err) {
    console.error('[receiver] gagal membaca status:', err);
    return statusCache.loaded ? statusCache.value : true;
  }
}

export async function setReceiverEnabled(redis: RedisLike, enabled: boolean): Promise<void> {
  await redis.set(KEYS.receiverEnabled, enabled ? 'true' : 'false');
  statusCache = { loaded: true, value: enabled, at: Date.now() };
  await redis.incr(KEYS.streamSeq);
}

export const __resetReceiverCache = () => {
  statusCache = { loaded: false, value: true, at: 0 };
};
