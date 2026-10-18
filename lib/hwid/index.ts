// HWID Fingerprinting & Watermarking (murni + I/O Redis).
//
// HWID dihitung dari identifier stabil Roblox: UserId + PlaceId. Bukan ID perangkat keras
// sejati (Roblox executor tidak menyajikannya secara portabel), melainkan fingerprint akun+game
// yang konsisten antara server (computeHwidHash) dan klien Lua (computeHwid di scriptTemplate).
// Algoritme: djb2 (sama dengan seedOf di scriptCrypto.ts) -> hex 8-karakter. Trade-off jujur:
// ruang 32-bit, sekadar penanda; bukan kriptografi. Titik integrasi gethwid() executor tersedia
// di scriptTemplate bila suatu saat dipakai.
import { randomUUID } from 'node:crypto';
import { KEYS } from '@/lib/keys';
import { parseStored } from '@/lib/http';
import { sealScript } from '@/lib/lua/scriptCrypto';
import type { RedisLike } from '@/lib/redis';
import type { HwidBinding, HwidDownloadRecord, HwidLeak } from '@/types';

const M = 4_294_967_296; // 2^32, aritmetika identik di Lua

// Hash djb2 atas `${userId}|${placeId}` -> hex 8-karakter. Cermin persis computeHwid() di Lua.
export function computeHwidHash(userId: string | number, placeId: string | number): string {
  const s = `${userId}|${placeId}`;
  let h = 5381;
  for (const b of Buffer.from(s, 'utf8')) h = (h * 33 + b) % M;
  if (h === 0) h = 0x9e3779b9;
  return (h >>> 0).toString(16).padStart(8, '0');
}

export const HWID_DOWNLOAD_TTL_SECONDS = 7 * 24 * 3600; // rekaman unduhan hidup 7 hari
export const HWID_LEAK_MAX = 500;

// ---------- Ikatan HWID ----------

export async function bindHwid(
  redis: RedisLike,
  accountId: string,
  userId: string,
  placeId: string,
  boundBy: string,
  nowMs = Date.now(),
): Promise<HwidBinding> {
  const hwidHash = computeHwidHash(userId, placeId);
  const binding: HwidBinding = {
    accountId,
    hwidHash,
    userId,
    placeId,
    boundAt: new Date(nowMs).toISOString(),
    boundBy,
  };
  await redis.hset(KEYS.hwidBind(accountId), { data: JSON.stringify(binding) });
  return binding;
}

export async function readBinding(redis: RedisLike, accountId: string): Promise<HwidBinding | null> {
  const raw = await redis.hget(KEYS.hwidBind(accountId), 'data');
  const parsed = parseStored<HwidBinding>(raw);
  return parsed && typeof parsed.hwidHash === 'string' ? parsed : null;
}

export async function unbindHwid(redis: RedisLike, accountId: string): Promise<boolean> {
  const removed = await redis.del(KEYS.hwidBind(accountId));
  return Number(removed) > 0;
}

// ---------- Rekaman unduhan (untuk watermark + validasi laporan kebocoran) ----------

// Membangkitkan payload watermark terenkripsi untuk disisipkan ke skrip Lua. Skema xorshift32
// (sealScript) dipakai agar Lua bisa mendekripsinya saat jalan (cermin di scriptTemplate). Kunci
// acak per-unduhan disimpan di Redis agar server bisa memvalidasi laporan kebocoran yang menyertakan
// downloadId + expectedHwid. Ini deterensi (bukan rahasia mutlak), sama seperti loader.lua.
export async function issueWatermark(
  redis: RedisLike,
  binding: HwidBinding,
  issuedBy: string,
  nowMs = Date.now(),
): Promise<{ record: HwidDownloadRecord; nonce: string; hex: string }> {
  const key = randomUUID().replace(/-/g, '').slice(0, 24); // kunci xorshift per-unduhan
  const id = randomUUID();
  const payload = JSON.stringify({
    accountId: binding.accountId,
    userId: binding.userId,
    placeId: binding.placeId,
    hwidHash: binding.hwidHash,
    issuedAt: new Date(nowMs).toISOString(),
    downloadId: id,
  });
  const { nonce, hex } = sealScript(payload, key);
  const record: HwidDownloadRecord = {
    id,
    accountId: binding.accountId,
    hwidHash: binding.hwidHash,
    key,
    issuedAt: new Date(nowMs).toISOString(),
    issuedBy,
  };
  // Simpan rekaman dengan TTL: laporan kebocoran setelah TTL ditolak (downloadId tak dikenal).
  await redis.set(KEYS.hwidDownload(id), JSON.stringify(record), { ex: HWID_DOWNLOAD_TTL_SECONDS });
  return { record, nonce, hex };
}

export async function readDownloadRecord(redis: RedisLike, id: string): Promise<HwidDownloadRecord | null> {
  const raw = await redis.get(KEYS.hwidDownload(id));
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const rec = JSON.parse(raw) as HwidDownloadRecord;
    return rec && typeof rec.key === 'string' ? rec : null;
  } catch {
    return null;
  }
}

// ---------- Laporan kebocoran ----------

// Mencatat kebocoran ke list hwid:leaks (terbaru di depan, dipangkas) dan menaikkan penanda SSE.
// TIDAK melempar: kegagalan mencatat hanya ditulis ke log server (sama seperti recordAudit).
export async function recordLeak(
  redis: RedisLike,
  leak: Omit<HwidLeak, 'id' | 'at'>,
  nowMs = Date.now(),
): Promise<HwidLeak | null> {
  try {
    const entry: HwidLeak = {
      id: randomUUID(),
      at: new Date(nowMs).toISOString(),
      ...leak,
    };
    await redis.lpush(KEYS.hwidLeaks, JSON.stringify(entry));
    await redis.ltrim(KEYS.hwidLeaks, 0, HWID_LEAK_MAX - 1);
    await redis.incr(KEYS.hwidLeakSeq);
    return entry;
  } catch (err) {
    console.error('[hwid] gagal mencatat kebocoran:', err);
    return null;
  }
}

export async function readLeaks(redis: RedisLike, limit = 100): Promise<HwidLeak[]> {
  const raw = await redis.lrange(KEYS.hwidLeaks, 0, Math.max(1, limit) - 1);
  return (raw ?? [])
    .map((r) => {
      if (typeof r === 'string') {
        try {
          return JSON.parse(r) as HwidLeak;
        } catch {
          return null;
        }
      }
      return r && typeof r === 'object' ? (r as HwidLeak) : null;
    })
    .filter((e): e is HwidLeak => e !== null && typeof e.accountId === 'string');
}
