import { Redis } from '@upstash/redis';

const url = process.env.KV_REST_API_URL || process.env.STORAGE_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || process.env.KV_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.STORAGE_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_READ_ONLY_TOKEN;

const redis = new Redis({ url, token });

export async function GET() {
  const startDb = Date.now();
  
  try {
    // 1. Ping latency
    await redis.ping();
    const dbPing = Date.now() - startDb;

    // 2. Ambil total log webhook
    const totalLogs = await redis.llen('webhook_logs');

    // 3. Panggil Upstash REST API /info resmi untuk statistik real-time DB
    let commandsCount = 0;
    let bandwidthFormatted = '0 KB';
    let usedFormatted = '0 MB';
    let percentage = '0.00';

    try {
      const infoRes = await fetch(`${url}/info`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store'
      });

      if (infoRes.ok) {
        const infoData = await infoRes.json();
        const infoText = typeof infoData.result === 'string' ? infoData.result : JSON.stringify(infoData);

        // Extract total commands dari response INFO Upstash
        const totalCmdsMatch = infoText.match(/total_commands_processed:(\d+)/);
        if (totalCmdsMatch) {
          commandsCount = parseInt(totalCmdsMatch[1], 10);
        }

        // Extract total net output bytes (Bandwidth)
        const netBytesMatch = infoText.match(/total_net_output_bytes:(\d+)/);
        if (netBytesMatch) {
          const bytes = parseInt(netBytesMatch[1], 10);
          bandwidthFormatted = bytes > 1024 * 1024 
            ? (bytes / (1024 * 1024)).toFixed(2) + ' MB'
            : (bytes / 1024).toFixed(1) + ' KB';
        }

        // Extract memory usage asli dari DB
        const memMatch = infoText.match(/used_memory:(\d+)/);
        if (memMatch) {
          const usedBytes = parseInt(memMatch[1], 10);
          usedFormatted = (usedBytes / (1024 * 1024)).toFixed(3) + ' MB';
          percentage = ((usedBytes / (256 * 1024 * 1024)) * 100).toFixed(4);
        }
      }
    } catch (e) {
      console.error('Gagal mengambil INFO real-time:', e);
    }

    return Response.json({
      status: 'online',
      dbPing: `${dbPing}ms`,
      totalLogs,
      commandsCount,
      bandwidthFormatted,
      usage: {
        usedFormatted,
        limitFormatted: '256 MB',
        percentage
      },
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    return Response.json({
      status: 'offline',
      dbPing: 'Error',
      error: err.message
    }, { status: 500 });
  }
}
