// Remote kill-switch / perintah kontrol (murni + I/O Redis).
//
// Perintah KILL/PAUSE/RESUME per accountId disimpan di control:cmd:<accountId> dengan TTL pendek
// (default 60 dtk). control:index = hash accountId -> ISO terbit, agar dashboard bisa mendaftar
// perintah aktif tanpa SCAN (tidak didukung baik di Upstash REST). Saat mendaftar, entry index
// yang perintahnya sudah kedaluwarsa (GET nil) dibersihkan serempak.
import { KEYS } from '@/lib/keys';
import type { RedisLike } from '@/lib/redis';
import type { ControlCommandType, ControlEntry } from '@/types';

export const DEFAULT_CONTROL_TTL = 60; // detik; skrip polling tiap 5 dtk pasti menangkapnya
const INDEX_CLEANUP_BATCH = 200;

export function isControlCommand(v: unknown): v is ControlCommandType {
  return v === 'KILL' || v === 'PAUSE' || v === 'RESUME';
}

// Simpan perintah dengan TTL. Mengembalikan entri untuk audit/dashboard.
export async function setControl(
  redis: RedisLike,
  accountId: string,
  command: ControlCommandType,
  setBy: string,
  ttlSeconds = DEFAULT_CONTROL_TTL,
  nowMs = Date.now(),
): Promise<ControlEntry> {
  const entry: ControlEntry = {
    accountId,
    command,
    setAt: new Date(nowMs).toISOString(),
    setBy,
    ttlSeconds,
  };
  await redis.set(KEYS.controlCmd(accountId), command, { ex: ttlSeconds });
  await redis.hset(KEYS.controlIndex, { [accountId]: entry.setAt });
  return entry;
}

// Baca perintah aktif untuk satu accountId. null = tidak ada (kedaluwarsa atau belum pernah).
export async function getControl(redis: RedisLike, accountId: string): Promise<ControlCommandType | null> {
  const raw = await redis.get(KEYS.controlCmd(accountId));
  const cmd = String(raw ?? '').trim().toUpperCase();
  return isControlCommand(cmd) ? cmd : null;
}

// Hapus perintah lebih awal (mis. setelah dashboard memastikan diterima).
export async function clearControl(redis: RedisLike, accountId: string): Promise<boolean> {
  const removed = await redis.del(KEYS.controlCmd(accountId));
  await redis.hdel(KEYS.controlIndex, accountId);
  return Number(removed) > 0;
}

// Daftar semua perintah aktif. Membaca index lalu GET tiap accountId; yang kedaluwarsa dibersihkan.
export async function listControls(redis: RedisLike, max = 500): Promise<ControlEntry[]> {
  const index = (await redis.hgetall(KEYS.controlIndex)) ?? {};
  const ids = Object.keys(index).slice(0, max);
  if (ids.length === 0) return [];
  const cmds = await Promise.all(ids.map((id) => getControl(redis, id)));
  const expired: string[] = [];
  const live: ControlEntry[] = [];
  for (let i = 0; i < ids.length; i += 1) {
    const cmd = cmds[i];
    if (cmd) {
      live.push({ accountId: ids[i], command: cmd, setAt: String(index[ids[i]]), setBy: '', ttlSeconds: DEFAULT_CONTROL_TTL });
    } else {
      expired.push(ids[i]);
    }
  }
  // Bersihkan entry index yang perintahnya sudah kedaluwarsa (batch kecil, anti-penumpukan).
  for (let i = 0; i < expired.length; i += INDEX_CLEANUP_BATCH) {
    await redis.hdel(KEYS.controlIndex, ...expired.slice(i, i + INDEX_CLEANUP_BATCH));
  }
  return live.sort((a, b) => b.setAt.localeCompare(a.setAt));
}
