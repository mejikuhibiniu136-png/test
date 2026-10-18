import { actorOf, recordAudit } from '@/lib/audit';
import { requireSuperadmin } from '@/lib/auth/session';
import { getPreviousEncryptionKeyState, tryGetEncryptionKeyHex } from '@/lib/env';
import { HttpError, errorResponse, json } from '@/lib/http';
import { getRedis } from '@/lib/redis';
import { reencryptSecrets } from '@/lib/settings';

export const dynamic = 'force-dynamic';

// Superadmin: enkripsi ulang secret yang masih memakai ENCRYPTION_KEY_PREVIOUS dengan
// ENCRYPTION_KEY saat ini. Aman diulang (secret yang sudah baru tidak disentuh).
export async function POST(request: Request) {
  try {
    const { session, denied } = await requireSuperadmin();
    if (denied) return denied;
    if (!tryGetEncryptionKeyHex()) throw new HttpError(400, 'ENCRYPTION_KEY belum diatur di Vercel');
    if (getPreviousEncryptionKeyState() !== 'valid') {
      throw new HttpError(400, 'ENCRYPTION_KEY_PREVIOUS belum diatur (atau bukan hex 64 karakter) di Vercel');
    }
    const redis = getRedis();
    const result = await reencryptSecrets(redis);
    await recordAudit(redis, {
      ...actorOf(session, request.headers),
      action: 'encryption.rotate',
      detail: `dienkripsi ulang ${result.rotated}, sudah baru ${result.alreadyCurrent}, gagal ${result.failed}`,
    });
    return json({ success: true, data: result });
  } catch (err) {
    return errorResponse(err, 'admin/encryption/rotate');
  }
}
