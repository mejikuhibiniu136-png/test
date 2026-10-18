// JWT (HS256) lewat `jose`. Hanya memakai Web API, jadi aman di proxy (Edge) maupun Node.js.
import { SignJWT, jwtVerify } from 'jose';
import type { Role, SessionClaims, UserStatus } from '@/types';

export const SESSION_COOKIE = 'session';
export const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60; // 8 jam
const ISSUER = 'dbdataentry';
const ROLES: readonly Role[] = ['superadmin', 'admin', 'viewer'];
const STATUSES: readonly UserStatus[] = ['pending', 'active', 'suspended', 'rejected'];

const encoder = new TextEncoder();

export async function signSession(
  claims: { sub: string; role: Role; status: UserStatus; sid: string },
  secret: string,
  nowMs = Date.now()
): Promise<string> {
  const iat = Math.floor(nowMs / 1000);
  return new SignJWT({ role: claims.role, status: claims.status, sid: claims.sid })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuer(ISSUER)
    .setIssuedAt(iat)
    .setExpirationTime(iat + SESSION_MAX_AGE_SECONDS)
    .sign(encoder.encode(secret));
}

export async function verifySession(token: string, secret: string, nowMs = Date.now()): Promise<SessionClaims | null> {
  if (!token || token.length > 2048 || !secret) return null;
  try {
    const { payload } = await jwtVerify(token, encoder.encode(secret), {
      issuer: ISSUER,
      algorithms: ['HS256'],
      currentDate: new Date(nowMs),
    });
    const role = payload.role;
    if (typeof payload.sub !== 'string' || !ROLES.includes(role as Role)) return null;
    // Token lama (sebelum RBAC berjenjang) tidak punya field status: anggap aktif agar sesi lama tidak langsung logout.
    const status = STATUSES.includes(payload.status as UserStatus) ? (payload.status as UserStatus) : 'active';
    return {
      sub: payload.sub,
      role: role as Role,
      status,
      sid: typeof payload.sid === 'string' ? payload.sid : '',
      iat: payload.iat,
      exp: payload.exp,
    };
  } catch {
    return null;
  }
}

// Cookie sesi: HttpOnly + SameSite=Strict; Secure di produksi (localhost via http tidak
// menerima cookie Secure di semua browser, jadi hanya dimatikan saat development).
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: '/',
  };
}
