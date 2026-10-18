// API Key dashboard (banyak key, berlabel, bisa kedaluwarsa). Yang disimpan di Redis hanya
// hash SHA-256 + metadata; nilai key ditampilkan SEKALI saat dibuat dan tidak bisa dipulihkan.
// Mencari key = hash request lalu HGET, jadi tidak ada perbandingan teks yang bocor lewat waktu.
import { createHash } from 'node:crypto';
import { HttpError, parseStored } from '@/lib/http';
import { KEYS, generateApiKey, maskApiKey } from '@/lib/keys';
import type { RedisLike } from '@/lib/redis';
import type { ApiKeyView } from '@/types';

export const MAX_API_KEYS = 20;
const KEY_FORMAT = /^dbde_[0-9a-f]{48}$/;
const USED_WRITE_INTERVAL_MS = 60_000;
const DAY_MS = 86_400_000;

interface StoredKey {
  id: string;
  label: string;
  hint: string;
  createdAt: string;
  createdBy: string;
  expiresAt: string | null;
}

export const hashApiKey = (key: string) => createHash('sha256').update(key).digest('hex');

// Kedaluwarsa tak terbaca = dianggap kedaluwarsa (gagal aman).
const isExpired = (expiresAt: string | null, nowMs: number) => expiresAt !== null && !(Date.parse(expiresAt) > nowMs);

export async function createApiKey(
  redis: RedisLike,
  input: { label: string; expiresInDays?: number | null; by: string },
  nowMs = Date.now()
): Promise<{ key: string; view: ApiKeyView }> {
  if (Number(await redis.hlen(KEYS.apiKeys)) >= MAX_API_KEYS) {
    throw new HttpError(400, `Maksimal ${MAX_API_KEYS} API Key. Cabut yang tidak dipakai dulu.`);
  }
  const key = generateApiKey();
  const hash = hashApiKey(key);
  const meta: StoredKey = {
    id: hash.slice(0, 12),
    label: input.label,
    hint: maskApiKey(key),
    createdAt: new Date(nowMs).toISOString(),
    createdBy: input.by,
    expiresAt: input.expiresInDays ? new Date(nowMs + input.expiresInDays * DAY_MS).toISOString() : null,
  };
  await redis.hset(KEYS.apiKeys, { [hash]: JSON.stringify(meta) });
  return { key, view: { ...meta, lastUsedAt: null, expired: false } };
}

export async function listApiKeys(redis: RedisLike, nowMs = Date.now()): Promise<ApiKeyView[]> {
  const [raw, used] = await Promise.all([redis.hgetall(KEYS.apiKeys), redis.hgetall(KEYS.apiKeysUsed)]);
  return Object.values(raw ?? {})
    .map((v) => parseStored<StoredKey>(v))
    .filter((m): m is StoredKey => m !== null && typeof m.id === 'string')
    .map((m) => {
      const last = used?.[m.id];
      return { ...m, lastUsedAt: typeof last === 'string' ? last : null, expired: isExpired(m.expiresAt, nowMs) };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function revokeApiKey(redis: RedisLike, id: string): Promise<boolean> {
  const raw = (await redis.hgetall(KEYS.apiKeys)) ?? {};
  const hash = Object.keys(raw).find((h) => parseStored<StoredKey>(raw[h])?.id === id);
  if (!hash) return false;
  await redis.hdel(KEYS.apiKeys, hash);
  await redis.hdel(KEYS.apiKeysUsed, id);
  return true;
}

// Penanda "terakhir dipakai" ditulis paling sering sekali per menit per key per instance, agar
// jalur ingest panas tidak menambah write Redis di setiap request. Disimpan di hash terpisah
// supaya penulisan ini tidak pernah bisa menghidupkan kembali key yang baru dicabut.
const usedWrittenAt = new Map<string, number>();
export const __resetApiKeyUsedThrottle = () => usedWrittenAt.clear();

export interface AuthenticatedKey {
  id: string;
  label: string;
}

export async function authenticateApiKey(redis: RedisLike, provided: string, nowMs = Date.now()): Promise<AuthenticatedKey | null> {
  if (!KEY_FORMAT.test(provided)) return null; // bukan format key dashboard: tanpa kunjungan Redis
  const meta = parseStored<StoredKey>(await redis.hget(KEYS.apiKeys, hashApiKey(provided)));
  if (!meta || typeof meta.id !== 'string' || isExpired(meta.expiresAt ?? null, nowMs)) return null;

  const last = usedWrittenAt.get(meta.id) ?? 0;
  if (nowMs - last >= USED_WRITE_INTERVAL_MS) {
    usedWrittenAt.set(meta.id, nowMs);
    try {
      await redis.hset(KEYS.apiKeysUsed, { [meta.id]: new Date(nowMs).toISOString() });
    } catch (err) {
      usedWrittenAt.delete(meta.id);
      console.error('[apikey] gagal mencatat waktu pakai:', err);
    }
  }
  return { id: meta.id, label: meta.label };
}
