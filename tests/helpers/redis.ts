// Adapter ioredis -> RedisLike (semantik Upstash). Dipakai agar tes menjalankan script Lua
// dan perintah Redis yang sungguhan, bukan tiruan.
import IORedis from 'ioredis';
import type { RedisLike } from '@/lib/redis';

export const TEST_REDIS_PORT = Number(process.env.TEST_REDIS_PORT ?? 6390);

export async function connectTestRedis(): Promise<{ redis: RedisLike; raw: IORedis } | null> {
  const raw = new IORedis({ port: TEST_REDIS_PORT, lazyConnect: true, maxRetriesPerRequest: 0, retryStrategy: () => null });
  raw.on('error', () => undefined);
  try {
    await raw.connect();
    await raw.ping();
  } catch {
    raw.disconnect();
    return null;
  }

  const redis: RedisLike = {
    get: (k) => raw.get(k),
    set: async (k, v, o) => {
      const val = typeof v === 'string' ? v : JSON.stringify(v);
      if (o?.nx) return raw.set(k, val, 'NX');
      if (o?.ex) return raw.set(k, val, 'EX', o.ex);
      return raw.set(k, val);
    },
    del: (...k) => raw.del(...k),
    incr: (k) => raw.incr(k),
    expire: (k, s) => raw.expire(k, s),
    ttl: (k) => raw.ttl(k),
    lpush: (k, ...v) => raw.lpush(k, ...v),
    ltrim: (k, a, b) => raw.ltrim(k, a, b),
    lrange: (k, a, b) => raw.lrange(k, a, b),
    llen: (k) => raw.llen(k),
    hget: (k, f) => raw.hget(k, f),
    hset: (k, v) => raw.hset(k, v),
    hsetnx: (k, f, v) => raw.hsetnx(k, f, v),
    hgetall: async (k) => {
      const r = await raw.hgetall(k);
      return Object.keys(r).length ? r : null;
    },
    hdel: (k, ...f) => raw.hdel(k, ...f),
    hlen: (k) => raw.hlen(k),
    hexists: (k, f) => raw.hexists(k, f),
    hincrby: (k, f, n) => raw.hincrby(k, f, n),
    zadd: (k, m) => raw.zadd(k, m.score, m.member),
    zrange: (k, a, b, o) => (o?.rev ? raw.zrange(k, String(a), String(b), 'REV') : raw.zrange(k, String(a), String(b))),
    zcard: (k) => raw.zcard(k),
    rename: (a, b) => raw.rename(a, b),
    eval: (script, keys, args) => raw.eval(script, keys.length, ...keys, ...args),
    exists: (...k) => raw.exists(...k),
    ping: () => raw.ping(),
  };
  return { redis, raw };
}
