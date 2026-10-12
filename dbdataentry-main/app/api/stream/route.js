import { Redis } from '@upstash/redis';

// Paksa Next.js agar memperlakukan route ini sebagai Full Dynamic Route
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const url = process.env.KV_REST_API_URL || process.env.STORAGE_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || process.env.KV_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.STORAGE_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_READ_ONLY_TOKEN;

const redis = new Redis({ url, token });

export async function GET(request) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const sendData = async () => {
        try {
          const rawLogs = await redis.lrange('webhook_logs', 0, 49);
          const rawAccounts = await redis.hgetall('account_status');

          const logs = (rawLogs || []).map(item => typeof item === 'string' ? JSON.parse(item) : item);
          const accounts = rawAccounts ? Object.values(rawAccounts).map(item => typeof item === 'string' ? JSON.parse(item) : item) : [];

          const payload = JSON.stringify({ logs, accounts, timestamp: Date.now() });
          controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
        } catch (err) {
          console.error('SSE Stream Inner Error:', err);
        }
      };

      await sendData();
      const interval = setInterval(sendData, 3000);

      request.signal.addEventListener('abort', () => {
        clearInterval(interval);
        controller.close();
      });
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive'
    }
  });
}
