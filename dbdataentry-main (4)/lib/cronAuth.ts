import { createHash, timingSafeEqual } from 'node:crypto';
import { json } from '@/lib/http';

const sha = (s: string) => createHash('sha256').update(s).digest();

// Vercel Cron mengirim "Authorization: Bearer <CRON_SECRET>". CRON_SECRET kosong = semua ditolak.
// Mengembalikan Response penolakan, atau null bila request sah.
export function checkCron(request: Request): Response | null {
  const secret = (process.env.CRON_SECRET ?? '').trim();
  if (!secret) return json({ success: false, message: 'CRON_SECRET belum diatur di Vercel' }, 503);
  const auth = request.headers.get('authorization') ?? '';
  const provided = /^bearer\s+/i.test(auth) ? auth.replace(/^bearer\s+/i, '').trim() : '';
  if (!provided || !timingSafeEqual(sha(provided), sha(secret))) return json({ success: false, message: 'Unauthorized' }, 401);
  return null;
}
