import { checkCron } from '@/lib/cronAuth';
import { drainQueue } from '@/lib/ingest/drain';
import { errorResponse, json } from '@/lib/http';
import { getRedis } from '@/lib/redis';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Jaring pengaman: menguras antrean walau tidak ada trafik baru yang memicunya. Pada paket Vercel Hobby
// cron hanya boleh harian; pada Pro ubah jadwal di vercel.json menjadi "* * * * *".
export async function GET(request: Request) {
  try {
    const denied = checkCron(request);
    if (denied) return denied;
    return json({ success: true, data: await drainQueue(getRedis(), { budgetMs: 45_000 }) });
  } catch (err) {
    return errorResponse(err, 'cron/ingest-drain');
  }
}
