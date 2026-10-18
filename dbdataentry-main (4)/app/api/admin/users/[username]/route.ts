import { actorOf, recordAudit } from '@/lib/audit';
import { requireSuperadmin } from '@/lib/auth/session';
import { getSuperadminConfig } from '@/lib/env';
import { HttpError, errorResponse, json, readJson } from '@/lib/http';
import { getRedis } from '@/lib/redis';
import { revokeAllForUser } from '@/lib/sessions';
import { updateUser, userKey } from '@/lib/users';
import { userUpdateSchema } from '@/schemas/admin';

export const dynamic = 'force-dynamic';

// Superadmin SATU-SATUNYA role yang boleh approve/reject pendaftaran, mengubah status
// (aktif/ditangguhkan/ditolak), atau mempromosikan/menurunkan role admin<->viewer.
export async function PATCH(request: Request, { params }: { params: Promise<{ username: string }> }) {
  try {
    const { session, denied } = await requireSuperadmin();
    if (denied) return denied;

    const { username } = await params;
    const key = userKey(decodeURIComponent(username));
    if (!/^[a-z0-9_.-]{1,64}$/.test(key)) return json({ success: false, message: 'Username tidak valid' }, 400);

    // Akun Superadmin (dari .env) permanen: tidak bisa diubah/ditangguhkan/dihapus lewat dashboard.
    try {
      if (key === userKey(getSuperadminConfig().username)) {
        throw new HttpError(400, 'Akun Superadmin tidak dapat diubah dari dashboard');
      }
    } catch (err) {
      if (err instanceof HttpError) throw err;
    }

    const parsed = userUpdateSchema.safeParse(await readJson(request, 1024));
    if (!parsed.success) return json({ success: false, message: parsed.error.issues[0]?.message ?? 'Data tidak valid' }, 400);

    const redis = getRedis();
    const updated = await updateUser(redis, key, parsed.data);
    const changes = [parsed.data.status !== undefined && `status=${parsed.data.status}`, parsed.data.role !== undefined && `role=${parsed.data.role}`].filter(Boolean).join(', ');
    // JWT membawa role/status di dalamnya: tanpa pencabutan, penurunan role atau penangguhan baru
    // berlaku setelah token kedaluwarsa (hingga 8 jam). Semua sesi pengguna ini dicabut sekarang.
    const revoked = await revokeAllForUser(redis, key).catch(() => 0);
    await recordAudit(redis, { ...actorOf(session, request.headers), action: 'user.update', target: updated.username, detail: `${changes}${revoked ? `, ${revoked} sesi dicabut` : ''}` });
    return json({ success: true, data: { username: updated.username, role: updated.role, status: updated.status } });
  } catch (err) {
    return errorResponse(err, 'admin/users PATCH');
  }
}
