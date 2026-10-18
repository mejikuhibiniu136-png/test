// Pembatas laju berbasis Redis (fixed window).
import type { RedisLike } from '@/lib/redis';

export interface RateResult {
  allowed: boolean;
  count: number;
  retryAfterSeconds: number;
}

export async function hitRateLimit(
  redis: RedisLike,
  key: string,
  { limit, windowSeconds }: { limit: number; windowSeconds: number }
): Promise<RateResult> {
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, windowSeconds);

  let retryAfterSeconds = windowSeconds;
  if (count > limit) {
    const ttl = await redis.ttl(key);
    if (typeof ttl === 'number' && ttl > 0) retryAfterSeconds = ttl;
    else await redis.expire(key, windowSeconds); // key tanpa TTL: pasang agar tidak terkunci selamanya
  }
  return { allowed: count <= limit, count, retryAfterSeconds };
}

export async function resetRateLimit(redis: RedisLike, key: string): Promise<void> {
  await redis.del(key);
}
