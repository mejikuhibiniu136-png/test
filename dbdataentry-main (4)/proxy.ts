import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySession } from '@/lib/auth/jwt';
import { tryGetJwtSecret } from '@/lib/env';
import { checkMaintenance, isIngestPath } from '@/lib/maintenance';

// API yang boleh diakses tanpa sesi, per metode HTTP. Selain ini, semua /api/* wajib login
// (default tertutup); route handler memeriksa sesi + role sekali lagi di dalamnya.
const PUBLIC_API: Record<string, string[]> = {
  '/api/auth/login': ['POST'],
  '/api/auth/register': ['POST'],
  '/api/auth/logout': ['POST'],
  '/api/maintenance': ['GET'], // status maintenance untuk skrip Lua yang sedang berjalan (tanpa data akun)
};
// Penerima webhook terbuka untuk semua sumber (token opsional dicek di handler-nya).
const PUBLIC_API_PREFIXES = ['/api/receiver/', '/api/cron/']; // /api/cron/* dijaga CRON_SECRET di route-nya
const PUBLIC_API_EXACT_ANY_METHOD = ['/api/webhook'];

const AUTH_PAGES = ['/login', '/register'];
const PENDING_PAGE = '/pending-approval';
// API yang tetap boleh diakses walau status akun belum 'active' (pending/suspended/rejected):
// agar halaman /pending-approval bisa menampilkan status & logout tanpa diblokir 403.
const API_ALLOWED_WHEN_NOT_ACTIVE = ['/api/auth/me', '/api/auth/logout'];
// Skrip Lua dimuat executor tanpa cookie.
const PUBLIC_PATHS = ['/scripts/'];

const normalize = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p);

export async function proxy(request: NextRequest) {
  const pathname = normalize(request.nextUrl.pathname);
  const method = request.method.toUpperCase();

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) return NextResponse.next();

  // Mode maintenance: tolak pengirim data di pintu depan (503), sebelum urusan sesi. Preflight CORS
  // tetap lolos. Dashboard, login, API admin, dan /scripts/* tidak terpengaruh.
  if (method !== 'OPTIONS' && isIngestPath(pathname)) {
    const blocked = await checkMaintenance();
    if (blocked) return blocked;
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const secret = tryGetJwtSecret();
  const session = token && secret ? await verifySession(token, secret) : null;
  // Superadmin selalu aktif; pengguna lain harus berstatus 'active' (lolos persetujuan Superadmin).
  const isActive = Boolean(session) && (session!.role === 'superadmin' || session!.status === 'active');

  // ----- API -----
  if (pathname === '/api' || pathname.startsWith('/api/')) {
    const methods = Object.prototype.hasOwnProperty.call(PUBLIC_API, pathname) ? PUBLIC_API[pathname] : null;
    if (
      (methods && methods.includes(method)) ||
      PUBLIC_API_PREFIXES.some((p) => pathname.startsWith(p)) ||
      PUBLIC_API_EXACT_ANY_METHOD.includes(pathname)
    ) {
      return NextResponse.next();
    }
    if (!session) {
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
    }
    // Akun pending/suspended/rejected: hanya boleh memeriksa sesi sendiri & logout, sisanya diblokir.
    if (!isActive && !API_ALLOWED_WHEN_NOT_ACTIVE.includes(pathname)) {
      return NextResponse.json(
        { success: false, message: 'Akun Anda belum disetujui Superadmin' },
        { status: 403, headers: { 'Cache-Control': 'no-store' } }
      );
    }
    return NextResponse.next();
  }

  // ----- Halaman -----
  const isAuthPage = AUTH_PAGES.includes(pathname);
  if (!session && !isAuthPage && pathname !== PENDING_PAGE) {
    const response = NextResponse.redirect(new URL('/login', request.url));
    if (token) response.cookies.delete(SESSION_COOKIE); // cookie lama / tidak valid
    return response;
  }
  if (session && isAuthPage) return NextResponse.redirect(new URL('/', request.url));

  if (pathname === PENDING_PAGE) {
    if (!session) return NextResponse.redirect(new URL('/login', request.url));
    if (isActive) return NextResponse.redirect(new URL('/', request.url)); // sudah disetujui: tidak perlu menunggu lagi
    return NextResponse.next();
  }
  if (session && !isActive && !isAuthPage) return NextResponse.redirect(new URL(PENDING_PAGE, request.url));

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt).*)'],
};
