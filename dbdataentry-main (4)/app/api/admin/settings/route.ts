import { actorOf, recordAudit } from '@/lib/audit';
import { requireSuperadmin } from '@/lib/auth/session';
import { tryGetEncryptionKeyHex } from '@/lib/env';
import { errorResponse, json, readJson } from '@/lib/http';
import { KEYS } from '@/lib/keys';
import { getRedis } from '@/lib/redis';
import type { RedisLike } from '@/lib/redis';
import { cleanMaintenanceMessage, clearSetting, inspectSecrets, readSettings, writeSecretSetting, writeSetting } from '@/lib/settings';
import { settingsUpdateSchema } from '@/schemas/admin';

export const dynamic = 'force-dynamic';

// Satu-satunya pembentuk respons GET dan PUT. Klien mengganti seluruh state dengan hasil PUT,
// jadi kedua metode WAJIB mengembalikan bentuk yang sama (encryptionReady, status enkripsi).
async function settingsResponse(redis: RedisLike) {
  return {
    success: true,
    data: await readSettings(redis),
    encryptionReady: Boolean(tryGetEncryptionKeyHex()),
    encryption: await inspectSecrets(redis),
  };
}

// Superadmin: status pengaturan dinamis saat ini. Nilai sensitif TIDAK pernah dikirim ke
// klien, hanya flag "sudah diisi" (webhookSecretSet).
export async function GET() {
  try {
    const { denied } = await requireSuperadmin();
    if (denied) return denied;
    return json(await settingsResponse(getRedis()));
  } catch (err) {
    return errorResponse(err, 'admin/settings GET');
  }
}

// Superadmin: perbarui pengaturan. WEBHOOK_SECRET dienkripsi AES-256-GCM sebelum disimpan;
// field lain disimpan langsung. Kirim string kosong pada webhookSecret untuk menghapusnya.
export async function PUT(request: Request) {
  try {
    const { session, denied } = await requireSuperadmin();
    if (denied) return denied;
    const parsed = settingsUpdateSchema.safeParse(await readJson(request, 4096));
    if (!parsed.success) return json({ success: false, message: parsed.error.issues[0]?.message ?? 'Data tidak valid' }, 400);

    const redis = getRedis();
    const { maintenanceMode, maintenanceMessage, rateLimitPerMin, luaObfuscationEnabled, apiKeyRequired, logRetentionDays, ingestQueueEnabled, webhookSecret } = parsed.data;
    const changes: string[] = [];

    if (maintenanceMode !== undefined) { await writeSetting(redis, 'MAINTENANCE_MODE', maintenanceMode); changes.push(`maintenanceMode=${maintenanceMode}`); }
    if (maintenanceMessage !== undefined) {
      // Kosong = hapus, sehingga server kembali memakai teks bawaan. Isinya tidak dicatat di audit.
      const cleaned = cleanMaintenanceMessage(maintenanceMessage);
      if (cleaned) await writeSetting(redis, 'MAINTENANCE_MESSAGE', cleaned);
      else await clearSetting(redis, 'MAINTENANCE_MESSAGE');
      changes.push(cleaned ? 'maintenanceMessage=diubah' : 'maintenanceMessage=dihapus');
    }
    if (rateLimitPerMin !== undefined) { await writeSetting(redis, 'RATE_LIMIT_PER_MIN', rateLimitPerMin); changes.push(`rateLimitPerMin=${rateLimitPerMin}`); }
    if (luaObfuscationEnabled !== undefined) { await writeSetting(redis, 'LUA_OBFUSCATION_ENABLED', luaObfuscationEnabled); changes.push(`luaObfuscationEnabled=${luaObfuscationEnabled}`); }
    if (apiKeyRequired !== undefined) { await writeSetting(redis, 'API_KEY_REQUIRED', apiKeyRequired); changes.push(`apiKeyRequired=${apiKeyRequired}`); }
    if (logRetentionDays !== undefined) { await writeSetting(redis, 'LOG_RETENTION_DAYS', logRetentionDays); changes.push(`logRetentionDays=${logRetentionDays}`); }
    if (ingestQueueEnabled !== undefined) { await writeSetting(redis, 'INGEST_QUEUE_ENABLED', ingestQueueEnabled); changes.push(`ingestQueueEnabled=${ingestQueueEnabled}`); }
    if (webhookSecret !== undefined) {
      if (webhookSecret === '') await redis.hdel(KEYS.settings, 'WEBHOOK_SECRET');
      else await writeSecretSetting(redis, 'WEBHOOK_SECRET', webhookSecret);
      changes.push(webhookSecret === '' ? 'webhookSecret=dihapus' : 'webhookSecret=diganti'); // nilainya tidak pernah dicatat
    }

    if (changes.length) await recordAudit(redis, { ...actorOf(session, request.headers), action: 'settings.update', detail: changes.join(', ') });
    return json(await settingsResponse(redis));
  } catch (err) {
    return errorResponse(err, 'admin/settings PUT');
  }
}
