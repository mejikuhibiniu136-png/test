import { Redis } from '@upstash/redis';

const url = process.env.KV_REST_API_URL || process.env.STORAGE_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || process.env.KV_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.STORAGE_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_READ_ONLY_TOKEN;

const redis = new Redis({ url, token });

// Ambil status saat ini
export async function GET() {
  try {
    const status = await redis.get('webhook:status');
    // Default aktif jika belum diset
    const isEnabled = status === null ? true : Boolean(status);
    return Response.json({ enabled: isEnabled });
  } catch (err) {
    return Response.json({ enabled: true, error: err.message });
  }
}

// Ubah status On/Off
export async function POST(request) {
  try {
    const { enabled } = await request.json();
    await redis.set('webhook:status', enabled);
    return Response.json({ success: true, enabled });
  } catch (err) {
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
}
