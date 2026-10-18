import { actorOf, recordAudit } from '@/lib/audit';
import { HttpError, errorResponse, getClientIp, json } from '@/lib/http';
import { KEYS } from '@/lib/keys';
import { readChannel } from '@/lib/notify/config';
import { dispatchAlert } from '@/lib/notify/dispatcher';
import { requirePermission } from '@/lib/rbac/guard';
import { hitRateLimit } from '@/lib/rateLimit';
import { getRedis } from '@/lib/redis';

export const dynamic = 'force-dynamic';

// Kirim pesan uji ke saluran tersimpan (mengabaikan filter dan peredam). Dibatasi 5x/menit agar
// endpoint ini tidak bisa dipakai sebagai meriam permintaan keluar.
export async function POST(request: Request) {
  try {
    const { session, denied } = await requirePermission('notify:manage');
    if (denied) return denied;
    const redis = getRedis();
    const rate = await hitRateLimit(redis, KEYS.rateLimit('notify-test', session.sub.toLowerCase()), { limit: 5, windowSeconds: 60 });
    if (!rate.allowed) throw new HttpError(429, 'Terlalu sering mengirim uji. Coba lagi sebentar lagi.', { 'Retry-After': String(rate.retryAfterSeconds) });

    const channel = await readChannel(redis, { fresh: true });
    if (!channel) throw new HttpError(400, 'Saluran notifikasi belum dikonfigurasi');
    const result = await dispatchAlert(redis, {
      kind: 'system.test', severity: 'info', title: 'Uji notifikasi dbdataentry',
      message: `Pesan uji dikirim oleh ${session.sub}. Jika Anda membaca ini, saluran berfungsi.`,
      fields: [{ name: 'Dari IP', value: getClientIp(request.headers) }, { name: 'Platform', value: channel.platform }],
    }, { force: true });
    await recordAudit(redis, { ...actorOf(session, request.headers), action: 'notify.test', target: channel.platform, detail: result.status });
    const ok = result.status === 'sent';
    return json({ success: ok, status: result.status, message: ok ? 'Pesan uji terkirim' : 'Pesan uji gagal dikirim. Periksa URL/token dan riwayat pengiriman.' }, ok ? 200 : 502);
  } catch (err) {
    return errorResponse(err, 'admin/notifications/test');
  }
}
