import { Redis } from '@upstash/redis';

const url = process.env.KV_REST_API_URL || process.env.STORAGE_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || process.env.KV_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.STORAGE_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_READ_ONLY_TOKEN;

const redis = new Redis({ url, token });

export async function POST() {
  try {
    // 1. Hapus riwayat log webhook
    await redis.del('webhook_logs');

    // 2. Hapus seluruh data status akun game
    await redis.del('account_status');

    return Response.json({ 
      success: true, 
      message: 'Riwayat log dan data status akun berhasil dibersihkan total.' 
    }, { status: 200 });
  } catch (err) {
    return Response.json({ 
      success: false, 
      error: err.message 
    }, { status: 500 });
  }
}
