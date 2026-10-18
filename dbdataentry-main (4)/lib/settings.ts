// Pengaturan dinamis tersimpan di Upstash Redis (hash config:settings), khusus Superadmin.
// Nilai sensitif (WEBHOOK_SECRET, API_KEY) disegel dengan envelope encryption berlapis
// (lib/security/crypto: AES-256-GCM + key wrap ChaCha20-Poly1305 + HMAC) sebelum ditulis; nilai non-sensitif (MAINTENANCE_MODE, RATE_LIMIT_PER_MIN, LUA_OBFUSCATION_ENABLED)
// disimpan langsung sebagai string. ENCRYPTION_KEY dan kredensial Superadmin TIDAK pernah
// lewat sini: keduanya hanya dibaca dari .env Vercel (lib/env.ts).
import { getPreviousEncryptionKeyState } from '@/lib/env';
import { KEYS } from '@/lib/keys';
import type { RedisLike } from '@/lib/redis';
import { NOTIFY_SEALED } from '@/lib/notify/config';
import { inspectSealedHash, rotateSealedHash, sealString, sumReports, tryOpenAny, type SealedHash } from '@/lib/security/crypto';
import type { EncryptionStatus, SystemSettings } from '@/types';

export const SENSITIVE_SETTINGS = ['WEBHOOK_SECRET', 'API_KEY'] as const;
export const PLAIN_SETTINGS = ['MAINTENANCE_MODE', 'MAINTENANCE_MESSAGE', 'RATE_LIMIT_PER_MIN', 'LUA_OBFUSCATION_ENABLED', 'API_KEY_REQUIRED', 'LOG_RETENTION_DAYS', 'INGEST_QUEUE_ENABLED'] as const;
export type SensitiveSettingKey = (typeof SENSITIVE_SETTINGS)[number];
export type PlainSettingKey = (typeof PLAIN_SETTINGS)[number];
export type SettingKey = SensitiveSettingKey | PlainSettingKey;

// Konteks mengikat ciphertext ke field-nya: nilai WEBHOOK_SECRET tidak bisa dipindah ke API_KEY.
export const settingContext = (field: string) => `settings:${field}`;

const isSensitive = (key: SettingKey): key is SensitiveSettingKey => (SENSITIVE_SETTINGS as readonly string[]).includes(key);

const DEFAULT_RATE_LIMIT = 600;
export const MAX_RETENTION_DAYS = 3650;
export const MAX_MAINTENANCE_MESSAGE = 200;
export const DEFAULT_MAINTENANCE_MESSAGE = 'Server sedang maintenance. Coba lagi beberapa saat lagi.';

// Teks maintenance tampil di panel skrip Lua milik pemain: buang karakter kontrol (termasuk
// baris baru), rapikan spasi, dan batasi panjangnya. Kosong -> teks bawaan.
export function cleanMaintenanceMessage(value: unknown): string {
  return String(value ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_MAINTENANCE_MESSAGE);
}

type PlainSettings = Omit<SystemSettings, 'webhookSecretSet'>;

const truthy = (v: unknown) => ['true', '1'].includes(String(v ?? '').trim().toLowerCase());

function parsePlain(raw: Record<string, unknown>): PlainSettings {
  const rateLimit = Number.parseInt(String(raw.RATE_LIMIT_PER_MIN ?? ''), 10);
  const retention = Number.parseInt(String(raw.LOG_RETENTION_DAYS ?? ''), 10);
  return {
    maintenanceMode: truthy(raw.MAINTENANCE_MODE),
    maintenanceMessage: cleanMaintenanceMessage(raw.MAINTENANCE_MESSAGE),
    rateLimitPerMin: Number.isFinite(rateLimit) && rateLimit > 0 ? Math.min(rateLimit, 100_000) : DEFAULT_RATE_LIMIT,
    luaObfuscationEnabled: truthy(raw.LUA_OBFUSCATION_ENABLED),
    apiKeyRequired: truthy(raw.API_KEY_REQUIRED),
    logRetentionDays: Number.isFinite(retention) && retention > 0 ? Math.min(retention, MAX_RETENTION_DAYS) : 0,
    ingestQueueEnabled: truthy(raw.INGEST_QUEUE_ENABLED),
  };
}

export async function readSettings(redis: RedisLike): Promise<SystemSettings> {
  const raw = (await redis.hgetall(KEYS.settings)) ?? {};
  return {
    ...parsePlain(raw),
    webhookSecretSet: typeof raw.WEBHOOK_SECRET === 'string' && raw.WEBHOOK_SECRET.length > 0,
  };
}

// Pengaturan yang dibaca di jalur ingest panas. Di-cache 5 dtk per instance supaya tiap webhook
// tidak menambah command Redis; gagal baca -> pakai cache terakhir, atau bawaan (terbuka, 600/mnt).
export interface RuntimeSettings {
  maintenanceMode: boolean;
  /** Teks yang akan ditampilkan; sudah memakai teks bawaan bila Superadmin tidak mengisinya. */
  maintenanceMessage: string;
  apiKeyRequired: boolean;
  rateLimitPerMin: number;
  ingestQueueEnabled: boolean;
}
const RUNTIME_CACHE_MS = 5000;
let runtimeCache: { value: RuntimeSettings; at: number } | null = null;

export async function readRuntimeSettings(redis: RedisLike, nowMs = Date.now()): Promise<RuntimeSettings> {
  if (runtimeCache && nowMs - runtimeCache.at < RUNTIME_CACHE_MS) return runtimeCache.value;
  try {
    const { maintenanceMode, maintenanceMessage, apiKeyRequired, rateLimitPerMin, ingestQueueEnabled } = parsePlain((await redis.hgetall(KEYS.settings)) ?? {});
    runtimeCache = {
      value: { maintenanceMode, maintenanceMessage: maintenanceMessage || DEFAULT_MAINTENANCE_MESSAGE, apiKeyRequired, rateLimitPerMin, ingestQueueEnabled },
      at: nowMs,
    };
    return runtimeCache.value;
  } catch (err) {
    console.error('[settings] gagal membaca pengaturan runtime:', err);
    // Gagal baca tanpa cache -> terbuka (maintenance mati), sama seperti perilaku bawaan lainnya.
    return runtimeCache?.value ?? { maintenanceMode: false, maintenanceMessage: DEFAULT_MAINTENANCE_MESSAGE, apiKeyRequired: false, rateLimitPerMin: DEFAULT_RATE_LIMIT, ingestQueueEnabled: false };
  }
}

export const __resetRuntimeSettingsCache = () => {
  runtimeCache = null;
};

// Cepat & murah: dipakai jalur ingest panas (tiap request webhook) tanpa menarik semua field.
export async function readLuaObfuscationEnabled(redis: RedisLike): Promise<boolean> {
  const v = String((await redis.hget(KEYS.settings, 'LUA_OBFUSCATION_ENABLED')) ?? '').trim().toLowerCase();
  return v === 'true' || v === '1';
}

export async function writeSetting(redis: RedisLike, key: SettingKey, value: string | boolean | number): Promise<void> {
  const stored = typeof value === 'boolean' ? String(value) : String(value);
  const toSave = isSensitive(key) ? sealString(stored, settingContext(key)) : stored;
  await redis.hset(KEYS.settings, { [key]: toSave });
  runtimeCache = null; // perubahan berlaku segera di instance ini
}

export async function clearSetting(redis: RedisLike, key: SettingKey): Promise<void> {
  await redis.hdel(KEYS.settings, key);
  runtimeCache = null; // sama seperti writeSetting: perubahan berlaku segera di instance ini
}

// Hanya dipakai server-side (mis. verifikasi HMAC webhook / tampilan Superadmin setelah klik "lihat").
// Tidak pernah melempar: key belum diisi atau ENCRYPTION_KEY rusak -> null, bukan error 500.
export async function readSecretSetting(redis: RedisLike, key: SensitiveSettingKey): Promise<string | null> {
  const raw = await redis.hget(KEYS.settings, key);
  return typeof raw === 'string' ? tryOpenAny(raw, settingContext(key)) : null;
}

// Dipakai saat generate API Key baru: nilai dienkripsi lalu disimpan, versi plain dikembalikan
// SEKALI SAJA ke klien (ditampilkan di dashboard) karena tidak disimpan ulang dalam bentuk plain.
export async function writeSecretSetting(redis: RedisLike, key: SensitiveSettingKey, plainValue: string): Promise<void> {
  await redis.hset(KEYS.settings, { [key]: sealString(plainValue, settingContext(key)) });
}

// ---------- Rotasi ENCRYPTION_KEY ----------

export const SETTINGS_SEALED: SealedHash = { key: KEYS.settings, fields: SENSITIVE_SETTINGS, contextFor: settingContext };

export async function inspectSecrets(redis: RedisLike): Promise<EncryptionStatus> {
  // Cakupan: secret pengaturan + kredensial saluran notifikasi (keduanya tersegel dengan KEK yang sama).
  const parts = await Promise.all([inspectSealedHash(redis, SETTINGS_SEALED), inspectSealedHash(redis, NOTIFY_SEALED)]);
  return { previousKey: getPreviousEncryptionKeyState(), stale: parts[0].stale + parts[1].stale, undecryptable: parts[0].undecryptable + parts[1].undecryptable };
}

export interface RotationResult {
  rotated: number;
  alreadyCurrent: number;
  failed: number;
}

// Menyegel ulang secret dengan KEK aktif: amplop v2 -> re-wrap DEK saja; format lama -> upgrade ke v2.
// Idempoten, dan memakai compare-and-set sehingga secret yang baru diganti tidak tertimpa.
export const reencryptSecrets = async (redis: RedisLike): Promise<RotationResult> => sumReports(await Promise.all([rotateSealedHash(redis, SETTINGS_SEALED), rotateSealedHash(redis, NOTIFY_SEALED)]));
