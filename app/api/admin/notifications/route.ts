import { actorOf, recordAudit } from '@/lib/audit';
import { HttpError, errorResponse, json, readJson } from '@/lib/http';
import { resolveAdapter } from '@/lib/notify/adapters';
import { clearChannel, readChannel, toView, writeChannel } from '@/lib/notify/config';
import { readDeliveries } from '@/lib/notify/dispatcher';
import type { StoredChannel } from '@/lib/notify/types';
import { requirePermission } from '@/lib/rbac/guard';
import { getRedis, type RedisLike } from '@/lib/redis';
import { tryGetEncryptionKeyHex } from '@/lib/env';
import { notifyUpdateSchema } from '@/schemas/notify';

export const dynamic = 'force-dynamic';

async function payload(redis: RedisLike) {
  return { success: true, channel: toView(await readChannel(redis, { fresh: true })), deliveries: await readDeliveries(redis, 15), encryptionReady: Boolean(tryGetEncryptionKeyHex()) };
}

// Superadmin: status saluran (tanpa URL/token utuh) + riwayat pengiriman terakhir.
export async function GET() {
  try {
    const { denied } = await requirePermission('notify:manage');
    if (denied) return denied;
    return json(await payload(getRedis()));
  } catch (err) {
    return errorResponse(err, 'admin/notifications GET');
  }
}

// Superadmin: simpan konfigurasi. URL/token disegel sebelum ditulis ke Redis dan tidak pernah dikembalikan.
export async function PUT(request: Request) {
  try {
    const { session, denied } = await requirePermission('notify:manage');
    if (denied) return denied;
    if (!tryGetEncryptionKeyHex()) throw new HttpError(400, 'ENCRYPTION_KEY belum diatur di Vercel: kredensial tidak dapat disegel');
    const parsed = notifyUpdateSchema.safeParse(await readJson(request, 4096));
    if (!parsed.success) return json({ success: false, message: parsed.error.issues[0]?.message ?? 'Data tidak valid' }, 400);

    const redis = getRedis();
    const prev = await readChannel(redis, { fresh: true });
    const d = parsed.data;
    const samePlatform = prev?.platform === d.platform;

    const next: StoredChannel = {
      platform: d.platform,
      enabled: d.enabled ?? (samePlatform ? prev!.enabled : true),
      minSeverity: d.minSeverity ?? (prev?.minSeverity ?? 'info'),
      kinds: d.kinds ?? (prev?.kinds ?? 'all'),
      updatedAt: new Date().toISOString(),
      updatedBy: session.sub,
    };
    if (d.platform === 'discord') {
      const webhookUrl = d.webhookUrl || (samePlatform ? prev?.discord?.webhookUrl : '') || '';
      if (!webhookUrl) throw new HttpError(400, 'URL Webhook Discord wajib diisi');
      next.discord = { webhookUrl };
    } else {
      const botToken = d.botToken || (samePlatform ? prev?.telegram?.botToken : '') || '';
      const chatId = d.chatId || (samePlatform ? prev?.telegram?.chatId : '') || '';
      if (!botToken || !chatId) throw new HttpError(400, 'Bot Token dan Chat ID Telegram wajib diisi');
      next.telegram = { botToken, chatId };
    }
    const resolved = resolveAdapter(next);
    const problem = resolved ? resolved.adapter.validate(resolved.target) : 'Konfigurasi tidak lengkap';
    if (problem) throw new HttpError(400, problem);

    await writeChannel(redis, next);
    // Catatan audit hanya memuat metadata, tidak pernah URL/token.
    await recordAudit(redis, { ...actorOf(session, request.headers), action: 'notify.update', target: next.platform, detail: `enabled=${next.enabled}, min=${next.minSeverity}, kinds=${next.kinds === 'all' ? 'all' : next.kinds.length}${(d.webhookUrl || d.botToken) ? ', kredensial diganti' : ''}` });
    return json(await payload(redis));
  } catch (err) {
    return errorResponse(err, 'admin/notifications PUT');
  }
}

export async function DELETE(request: Request) {
  try {
    const { session, denied } = await requirePermission('notify:manage');
    if (denied) return denied;
    const redis = getRedis();
    await clearChannel(redis);
    await recordAudit(redis, { ...actorOf(session, request.headers), action: 'notify.update', detail: 'saluran dihapus' });
    return json(await payload(redis));
  } catch (err) {
    return errorResponse(err, 'admin/notifications DELETE');
  }
}
