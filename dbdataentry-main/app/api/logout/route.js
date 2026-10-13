import { cookies } from 'next/headers';

export async function POST() {
  cookies().delete('auth_token');
  return Response.json({ success: true });
}
