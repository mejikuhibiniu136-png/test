import { Redis } from '@upstash/redis';

const url = process.env.KV_REST_API_URL || process.env.STORAGE_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || process.env.KV_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.STORAGE_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_READ_ONLY_TOKEN;

const redis = new Redis({ url, token });

let cachedStatus = null;
let lastCacheTime = 0;

export async function POST(request) {
  const now = Date.now();

  if (cachedStatus === null || now - lastCacheTime > 30000) {
    try {
      const isEnabled = await redis.get('webhook:status');
      cachedStatus = isEnabled === null ? true : Boolean(isEnabled);
      lastCacheTime = now;
    } catch (e) {
      cachedStatus = true;
    }
  }

  if (!cachedStatus) {
    return Response.json({ success: false, message: 'Receiver is OFF.' }, { status: 503 });
  }

  try {
    const startTime = Date.now();
    const payload = await request.json();

    let eventType = request.headers.get('x-github-event') || 
                      request.headers.get('x-event-type') || 
                      payload?.event || 
                      payload?.eventType;

    const embedTitle = payload?.embeds?.[0]?.title;
    if (embedTitle) {
      eventType = embedTitle;
    } else if (!eventType) {
      eventType = 'Custom Webhook';
    }

    const processingTime = Date.now() - startTime;

    const logData = {
      id: crypto.randomUUID(),
      eventType,
      payload,
      processingTimeMs: processingTime,
      receivedAt: new Date().toISOString()
    };

    await redis.lpush('webhook_logs', JSON.stringify(logData));
    await redis.ltrim('webhook_logs', 0, 199);

    // OTOMATIS SYNC STATUS AKUN JIKA MERUPAKAN PAYLOAD ROBLOX/GAME
    const accUsername = payload?.username;
    if (accUsername) {
      const accountData = {
        username: accUsername,
        displayName: payload.displayName || accUsername,
        status: payload.event || 'ONLINE',
        scriptName: payload.gameName || 'Anime Dice',
        avatarUrl: payload.avatarUrl || '',
        jobId: payload.jobId || '',
        lastUpdate: new Date().toISOString()
      };
      await redis.hset('account_status', {
        [accUsername]: JSON.stringify(accountData)
      });
    }

    return Response.json({ success: true, message: 'Data webhook tersimpan' }, { status: 200 });

  } catch (err) {
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function GET() {
  try {
    const rawLogs = await redis.lrange('webhook_logs', 0, 199);
    const logs = rawLogs.map((item) => typeof item === 'string' ? JSON.parse(item) : item);
    return Response.json({ success: true, data: logs });
  } catch (err) {
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
}
