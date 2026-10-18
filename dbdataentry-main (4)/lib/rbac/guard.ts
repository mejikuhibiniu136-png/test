// Penjaga route berbasis izin (runtime Node.js). Menggantikan pola `role === 'admin'` yang tersebar.
// requireAdmin/requireSuperadmin lama tetap ada di lib/auth/session.ts dan setara dengan matriks ini.
import { getSession } from '@/lib/auth/session';
import { json, unauthorized } from '@/lib/http';
import { can, type Permission } from '@/lib/rbac/permissions';
import type { SessionClaims } from '@/types';

type Guard = { session: SessionClaims; denied?: undefined } | { session?: undefined; denied: Response };

export async function requirePermission(permission: Permission): Promise<Guard> {
  const session = await getSession();
  if (!session) return { denied: unauthorized() };
  // Akun belum disetujui tidak pernah memegang izin apa pun (superadmin selalu aktif).
  if (session.role !== 'superadmin' && session.status !== 'active') return { denied: json({ success: false, message: 'Akun Anda belum disetujui Superadmin' }, 403) };
  if (!can(session.role, permission)) return { denied: json({ success: false, message: 'Anda tidak memiliki izin untuk aksi ini' }, 403) };
  return { session };
}
