import { cookies } from 'next/headers';
import { SESSION_COOKIE, sessionCookieOptions } from '@/lib/auth/jwt';
import { performLogin } from '@/lib/auth/login';
import { errorResponse, json, readJson } from '@/lib/http';
import { getRedis, type RedisLike } from '@/lib/redis';
import { loginSchema } from '@/schemas/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const parsed = loginSchema.safeParse(await readJson(request, 4096));
    if (!parsed.success) return json({ success: false, message: 'Username atau password salah' }, 401);

    let redis: RedisLike | null = null;
    try {
      redis = getRedis();
    } catch (err) {
      console.error('[login] Redis belum dikonfigurasi:', err);
    }

    const result = await performLogin(redis, request.headers, parsed.data.username, parsed.data.password);
    (await cookies()).set(SESSION_COOKIE, result.token, sessionCookieOptions());
    return json({ success: true, username: result.username, role: result.role, status: result.status });
  } catch (err) {
    return errorResponse(err, 'auth/login');
  }
}
