import { recordAudit } from '@/lib/audit';
import { checkCron } from '@/lib/cronAuth';
import { tryGetEncryptionKeyHex } from '@/lib/env';
import { errorResponse, json } from '@/lib/http';
import { emitAlert } from '@/lib/notify/emit';
import { getRedis } from '@/lib/redis';
import { reencryptSecrets } from '@/lib/settings';

export const dynamic = 'force-dynamic';

// Rotasi otomatis: setelah operator mengganti ENCRYPTION_KEY (kunci lama dipindah ke
// ENCRYPTION_KEY_PREVIOUS) dan redeploy, sapuan ini membungkus ulang DEK semua rekaman tersegel dan
// meng-upgrade format lama. Idempoten dan murah: rekaman yang sudah memakai KEK aktif dilewati.
// Catatan jujur: KEK tinggal di Environment Variable yang tidak bisa diubah dari runtime, jadi
// PEMBUATAN KEK baru tetap tindakan operator (atau KMS eksternal); yang diotomatisasi adalah migrasinya.
export async function GET(request: Request) {
  try {
    const denied = checkCron(request);
    if (denied) return denied;
    if (!tryGetEncryptionKeyHex()) return json({ success: true, skipped: true, message: 'ENCRYPTION_KEY belum diatur' });
    const redis = getRedis();
    const report = await reencryptSecrets(redis); // jalur yang sama dengan tombol manual Superadmin
    if (report.rotated > 0 || report.failed > 0) {
      await recordAudit(redis, { actor: 'cron', role: 'system', action: 'crypto.sweep', detail: `disegel ulang ${report.rotated}, sudah baru ${report.alreadyCurrent}, gagal ${report.failed}` });
    }
    if (report.failed > 0) {
      await emitAlert({ kind: 'crypto.rotation', severity: 'critical', title: 'Rotasi KEK: ada rahasia yang tidak bisa dibuka', message: `${report.failed} nilai tersegel tidak dapat dibuka atau diperbarui. Pastikan ENCRYPTION_KEY_PREVIOUS berisi kunci lama yang benar.`, fields: [{ name: 'Gagal', value: String(report.failed) }], dedupeKey: 'sweep-failed' }, { redis });
    }
    return json({ success: true, data: report });
  } catch (err) {
    return errorResponse(err, 'cron/crypto-rotate');
  }
}
