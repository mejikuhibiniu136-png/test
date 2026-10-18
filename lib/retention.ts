// Retensi log berbasis waktu (melengkapi batas jumlah LOG_MAX_*). Log disimpan terbaru di depan,
// jadi yang kedaluwarsa selalu berada di ekor list: script ini memangkas dari ekor secara atomik
// selama entri lebih tua dari batas. receivedAt berformat ISO-8601 UTC sehingga urutan teks =
// urutan waktu. Hanya key log yang disentuh (users:*, tracker, metadata tidak).
import { KEYS } from '@/lib/keys';
import type { RedisLike } from '@/lib/redis';

export const PURGE_SCRIPT = `
local cutoff = ARGV[1]
local removed = 0
while true do
  local v = redis.call('LINDEX', KEYS[1], -1)
  if not v then break end
  local ok, obj = pcall(cjson.decode, v)
  if not (ok and type(obj) == 'table' and type(obj.receivedAt) == 'string' and obj.receivedAt < cutoff) then break end
  redis.call('RPOP', KEYS[1])
  removed = removed + 1
end
return removed
`;

export interface PurgeResult {
  removed: number;
  keys: number;
}

export async function purgeOldLogs(redis: RedisLike, days: number, nowMs = Date.now()): Promise<PurgeResult> {
  if (!(days > 0)) return { removed: 0, keys: 0 };
  const cutoff = new Date(nowMs - days * 86_400_000).toISOString();
  const slugs = Object.keys((await redis.hgetall(KEYS.gamesMeta)) ?? {});
  const keys = [KEYS.streamLogs, ...slugs.map(KEYS.gameLogs)];
  let removed = 0;
  for (const key of keys) removed += Number(await redis.eval(PURGE_SCRIPT, [key], [cutoff])) || 0;
  if (removed > 0) await redis.incr(KEYS.streamSeq); // SSE memuat ulang
  return { removed, keys: keys.length };
}
