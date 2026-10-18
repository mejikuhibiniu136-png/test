// Pembacaan environment variable terpusat. Tidak ada nilai bawaan untuk rahasia:
// jika variabel belum diset, fungsi melempar ConfigError yang menyebut nama variabelnya,
// supaya kegagalan konfigurasi mudah ditemukan di log server.

export class ConfigError extends Error {
  readonly missing: string[];
  constructor(missing: string[], detail?: string) {
    super(detail ?? `Environment variable belum dikonfigurasi: ${missing.join(', ')}`);
    this.name = 'ConfigError';
    this.missing = missing;
  }
}

export const MIN_JWT_SECRET_LENGTH = 32;

type Env = Record<string, string | undefined>;

const clean = (v: string | undefined) => (typeof v === 'string' ? v.trim() : '');

export function getRedisConfig(env: Env = process.env): { url: string; token: string } {
  // KV_* / STORAGE_* diisi otomatis oleh integrasi Upstash di Vercel Marketplace.
  const url = clean(env.UPSTASH_REDIS_REST_URL) || clean(env.KV_REST_API_URL) || clean(env.STORAGE_REST_API_URL);
  const token = clean(env.UPSTASH_REDIS_REST_TOKEN) || clean(env.KV_REST_API_TOKEN) || clean(env.STORAGE_REST_API_TOKEN);
  const missing: string[] = [];
  if (!url) missing.push('UPSTASH_REDIS_REST_URL');
  if (!token) missing.push('UPSTASH_REDIS_REST_TOKEN');
  if (missing.length) throw new ConfigError(missing);
  return { url, token };
}

export function getJwtSecret(env: Env = process.env): string {
  const secret = clean(env.JWT_SECRET);
  if (!secret) throw new ConfigError(['JWT_SECRET']);
  if (secret.length < MIN_JWT_SECRET_LENGTH) {
    throw new ConfigError(['JWT_SECRET'], `JWT_SECRET terlalu pendek (minimal ${MIN_JWT_SECRET_LENGTH} karakter)`);
  }
  return secret;
}

// Versi tidak melempar: dipakai proxy/halaman yang harus tetap hidup walau env belum lengkap.
export function tryGetJwtSecret(env: Env = process.env): string | null {
  try {
    return getJwtSecret(env);
  } catch {
    return null;
  }
}

export function getAdminConfig(env: Env = process.env): { username: string; passwordHash: string } {
  const username = clean(env.ADMIN_USERNAME);
  const passwordHash = clean(env.ADMIN_PASSWORD_HASH);
  const missing: string[] = [];
  if (!username) missing.push('ADMIN_USERNAME');
  if (!passwordHash) missing.push('ADMIN_PASSWORD_HASH');
  if (missing.length) throw new ConfigError(missing);
  return { username, passwordHash };
}

// Superadmin: role tertinggi, SELALU berasal dari Environment Variable Vercel, tidak pernah
// disimpan di Redis. SUPERADMIN_USERNAME/SUPERADMIN_PASSWORD_HASH adalah nama resmi;
// ADMIN_USERNAME/ADMIN_PASSWORD_HASH (versi sebelumnya) tetap diterima sebagai alias lama
// supaya deployment yang sudah ada tidak terkunci keluar setelah upgrade.
export function getSuperadminConfig(env: Env = process.env): { username: string; passwordHash: string } {
  const username = clean(env.SUPERADMIN_USERNAME) || clean(env.ADMIN_USERNAME);
  const passwordHash = clean(env.SUPERADMIN_PASSWORD_HASH) || clean(env.ADMIN_PASSWORD_HASH);
  const missing: string[] = [];
  if (!username) missing.push('SUPERADMIN_USERNAME');
  if (!passwordHash) missing.push('SUPERADMIN_PASSWORD_HASH');
  if (missing.length) throw new ConfigError(missing);
  return { username, passwordHash };
}

export const MIN_ENCRYPTION_KEY_HEX_LENGTH = 64; // 32 byte AES-256 = 64 karakter hex

// Kunci enkripsi AES-256-GCM untuk nilai sensitif di Redis (WEBHOOK_SECRET, API_KEY).
// Hanya dibaca dari .env Vercel, tidak pernah disimpan di Redis.
export function getEncryptionKeyHex(env: Env = process.env): string {
  const key = clean(env.ENCRYPTION_KEY);
  if (!key) throw new ConfigError(['ENCRYPTION_KEY']);
  if (!/^[0-9a-fA-F]{64}$/.test(key)) {
    throw new ConfigError(['ENCRYPTION_KEY'], 'ENCRYPTION_KEY harus berupa string hex 32-byte (64 karakter)');
  }
  return key;
}

export function tryGetEncryptionKeyHex(env: Env = process.env): string | null {
  try {
    return getEncryptionKeyHex(env);
  } catch {
    return null;
  }
}

// Kunci lama untuk rotasi (opsional). Selama diisi, ciphertext lama tetap bisa dibaca sampai
// Superadmin menekan "Enkripsi ulang"; setelah itu variabel ini boleh dihapus dari Vercel.
export function tryGetPreviousEncryptionKeyHex(env: Env = process.env): string | null {
  const key = clean(env.ENCRYPTION_KEY_PREVIOUS);
  return /^[0-9a-fA-F]{64}$/.test(key) ? key : null;
}

export type PreviousKeyState = 'unset' | 'valid' | 'invalid';

export function getPreviousEncryptionKeyState(env: Env = process.env): PreviousKeyState {
  const key = clean(env.ENCRYPTION_KEY_PREVIOUS);
  if (!key) return 'unset';
  return /^[0-9a-fA-F]{64}$/.test(key) ? 'valid' : 'invalid';
}

export interface EnvReport {
  ok: boolean;
  required: { name: string; set: boolean; note?: string }[];
}

// Laporan status (tanpa nilai) untuk panel Sistem admin.
export function getEnvReport(env: Env = process.env): EnvReport {
  const redisUrl = Boolean(clean(env.UPSTASH_REDIS_REST_URL) || clean(env.KV_REST_API_URL) || clean(env.STORAGE_REST_API_URL));
  const redisToken = Boolean(clean(env.UPSTASH_REDIS_REST_TOKEN) || clean(env.KV_REST_API_TOKEN) || clean(env.STORAGE_REST_API_TOKEN));
  const secret = clean(env.JWT_SECRET);
  const hash = clean(env.SUPERADMIN_PASSWORD_HASH) || clean(env.ADMIN_PASSWORD_HASH);
  const hashOk = /^\$(argon2id|2[aby])\$/.test(hash);
  const encKey = clean(env.ENCRYPTION_KEY);
  const encKeyOk = /^[0-9a-fA-F]{64}$/.test(encKey);
  const required = [
    { name: 'UPSTASH_REDIS_REST_URL', set: redisUrl },
    { name: 'UPSTASH_REDIS_REST_TOKEN', set: redisToken },
    { name: 'SUPERADMIN_USERNAME', set: Boolean(clean(env.SUPERADMIN_USERNAME) || clean(env.ADMIN_USERNAME)) },
    {
      name: 'SUPERADMIN_PASSWORD_HASH',
      set: hashOk,
      note: hash && !hashOk ? 'Format bukan Argon2id/bcrypt (di .env, $ harus ditulis \\$)' : undefined,
    },
    {
      name: 'JWT_SECRET',
      set: secret.length >= MIN_JWT_SECRET_LENGTH,
      note: secret && secret.length < MIN_JWT_SECRET_LENGTH ? `Kurang dari ${MIN_JWT_SECRET_LENGTH} karakter` : undefined,
    },
    {
      name: 'ENCRYPTION_KEY',
      set: encKeyOk,
      note: encKey && !encKeyOk ? `Harus hex 32-byte (${MIN_ENCRYPTION_KEY_HEX_LENGTH} karakter)` : !encKey ? 'Diperlukan untuk enkripsi Webhook Secret / API Key' : undefined,
    },
  ];
  return { ok: required.every((r) => r.set), required };
}

export function envInt(name: string, fallback: number, min: number, max: number, env: Env = process.env): number {
  const n = Number.parseInt(clean(env[name]), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}
