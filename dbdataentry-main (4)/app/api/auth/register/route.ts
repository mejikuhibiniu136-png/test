import { performRegister } from '@/lib/auth/login';
import { errorResponse, json, readJson } from '@/lib/http';
import { getRedis } from '@/lib/redis';
import { registerSchema } from '@/schemas/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const parsed = registerSchema.safeParse(await readJson(request, 4096));
    if (!parsed.success) {
      return json({ success: false, message: parsed.error.issues[0]?.message ?? 'Data tidak valid' }, 400);
    }
    const user = await performRegister(getRedis(), request.headers, parsed.data.username, parsed.data.password);
    return json({ success: true, ...user }, 201);
  } catch (err) {
    return errorResponse(err, 'auth/register');
  }
}
