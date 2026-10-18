// Sesi sisi server (runtime Node.js). Jangan diimpor dari proxy.ts.
import { cookies } from 'next/headers';
import { forbidden, forbiddenSuperadmin, unauthorized } from '@/lib/http';
import { tryGetJwtSecret } from '@/lib/env';
import { SESSION_COOKIE, verifySession } from '@/lib/auth/jwt';
import { getRedis } from '@/lib/redis';
import { isSessionRevoked, touchSession } from '@/lib/sessions';
import type { SessionClaims } from '@/types';

export async function getSession(): Promise<SessionClaims | null> {
  const secret = tryGetJwtSecret();
  if (!secret) return null;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token, secret) : null;
  if (!session) return null;
  // Sesi yang dicabut (force revoke / logout / role diubah) ditolak walau JWT-nya masih berlaku.
  // Redis tidak terjangkau: gagal-terbuka, karena tanpa Redis seluruh dashboard memang tidak berfungsi.
  try {
    const redis = getRedis();
    if (session.sid && (await isSessionRevoked(redis, session.sid))) return null;
    void touchSession(redis, session.sub, session.sid).catch(() => undefined);
  } catch (err) {
    console.error('[session] pemeriksaan pencabutan dilewati:', err instanceof Error ? err.message : err);
  }
  return session;
}

type Guard = { session: SessionClaims; denied?: undefined } | { session?: undefined; denied: Response };

export async function requireSession(): Promise<Guard> {
  const session = await getSession();
  return session ? { session } : { denied: unauthorized() };
}

// Staf (admin + superadmin): CRUD akun/game, hapus log, lihat daftar pengguna.
// Viewer (read-only) ditolak di sini walau sudah login.
export async function requireAdmin(): Promise<Guard> {
  const session = await getSession();
  if (!session) return { denied: unauthorized() };
  if (session.role !== 'admin' && session.role !== 'superadmin') return { denied: forbidden() };
  return { session };
}

// Hanya Superadmin (akun dari .env Vercel): persetujuan pendaftaran, role/status pengguna,
// Pengaturan Sistem, API Key, Secret Token HMAC, proteksi skrip Lua.
export async function requireSuperadmin(): Promise<Guard> {
  const session = await getSession();
  if (!session) return { denied: unauthorized() };
  if (session.role !== 'superadmin') return { denied: forbiddenSuperadmin() };
  return { session };
}
