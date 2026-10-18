import { requireSession } from '@/lib/auth/session';
import { json } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { session, denied } = await requireSession();
  if (denied) return denied;
  return json({ username: session.sub, role: session.role, status: session.status });
}
