import { requireAdmin } from '@/lib/auth/session';
import { getSuperadminConfig } from '@/lib/env';
import { errorResponse, json } from '@/lib/http';
import { getRedis } from '@/lib/redis';
import { listUsers, readDevices, userKey } from '@/lib/users';
import type { UserSummary } from '@/types';

export const dynamic = 'force-dynamic';

// Staf (admin + superadmin) boleh membaca daftar pengguna; hanya Superadmin yang boleh
// mengubahnya (lihat [username]/route.ts PATCH). Admin: read-only di sini.
export async function GET() {
  try {
    const { denied } = await requireAdmin();
    if (denied) return denied;
    const redis = getRedis();
    const users = await listUsers(redis);

    // Superadmin berasal dari env (bukan users:*): permanen, selalu aktif, tidak bisa diubah.
    const superadmin = getSuperadminConfig();
    const superadminRow: UserSummary = {
      username: superadmin.username,
      role: 'superadmin',
      status: 'active',
      createdAt: null,
      lastLogin: (await readDevices(redis, userKey(superadmin.username), 1))[0] ?? null,
      immutable: true,
    };
    return json({ success: true, data: [superadminRow, ...users] });
  } catch (err) {
    return errorResponse(err, 'admin/users GET');
  }
}
