import { errorResponse, getClientIp, json, readJson } from '@/lib/http';
import { getRedis } from '@/lib/redis';
import { recordLeak, readDownloadRecord } from '@/lib/hwid';
import { bumpSeq } from '@/lib/games';
import { hwidLeakReportSchema } from '@/schemas/hwid';

export const dynamic = 'force-dynamic';

// Endpoint laporan kebocoran dari skrip Lua (terbuka: skrip tidak memegang cookie/sesi).
// Integritas: downloadId harus ada di Redis (hwid:dl:<id>, ber-TTL) dan expectedHwid pada laporan
// harus cocok dengan hwidHash rekaman. Tanpa itu, laporan ditolak (mencegah pemalsuan massal).
// Catatan jujur: pemegang skrip bisa membaca expectedHwid (tertanam terenkripsi), jadi ini mencegah
// laporan palsu acak, bukan pelaku yang sudah membongkar skrip sepenuhnya.
export async function POST(request: Request) {
  try {
    const parsed = hwidLeakReportSchema.safeParse(await readJson(request, 2048));
    if (!parsed.success) return json({ success: false, message: parsed.error.issues[0]?.message ?? 'Data tidak valid' }, 400);
    const { downloadId, accountId, expectedHwid, detectedHwid, reason } = parsed.data;

    const redis = getRedis();
    const record = await readDownloadRecord(redis, downloadId);
    if (!record) return json({ success: false, message: 'Download tidak dikenal (kedaluwarsa)' }, 410);
    if (record.accountId !== accountId || record.hwidHash !== expectedHwid) {
      return json({ success: false, message: 'Laporan tidak konsisten dengan rekaman unduhan' }, 409);
    }

    await recordLeak(redis, {
      accountId,
      expectedHwid,
      detectedHwid,
      reason,
      ip: getClientIp(request.headers),
    });
    // Naikkan penanda SSE agar dashboard langsung melihat kebocoran baru di stream.
    await bumpSeq(redis).catch(() => undefined);
    return json({ success: true }, 202);
  } catch (err) {
    return errorResponse(err, 'hwid/report POST');
  }
}
