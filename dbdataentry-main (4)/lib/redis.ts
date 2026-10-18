import { Redis } from '@upstash/redis';
import { getRedisConfig } from '@/lib/env';

// Subset perintah Redis yang dipakai aplikasi. Dipisah sebagai tipe supaya modul data
// mudah diuji dengan Redis sungguhan (adapter) tanpa bergantung pada klien REST.
export interface RedisLike {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown, opts?: { nx?: boolean; ex?: number }): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
  ttl(key: string): Promise<number>;
  lpush(key: string, ...values: string[]): Promise<number>;
  ltrim(key: string, start: number, stop: number): Promise<unknown>;
  lrange(key: string, start: number, stop: number): Promise<unknown[]>;
  llen(key: string): Promise<number>;
  hget(key: string, field: string): Promise<unknown>;
  hset(key: string, values: Record<string, string>): Promise<number>;
  hsetnx(key: string, field: string, value: string): Promise<number>;
  hgetall(key: string): Promise<Record<string, unknown> | null>;
  hdel(key: string, ...fields: string[]): Promise<number>;
  hlen(key: string): Promise<number>;
  hexists(key: string, field: string): Promise<number>;
  hincrby(key: string, field: string, by: number): Promise<number>;
  zadd(key: string, member: { score: number; member: string }): Promise<unknown>;
  zrange(key: string, start: number, stop: number, opts?: { rev?: boolean }): Promise<unknown[]>;
  zcard(key: string): Promise<number>;
  rename(src: string, dst: string): Promise<unknown>;
  eval(script: string, keys: string[], args: string[]): Promise<unknown>;
  exists(...keys: string[]): Promise<number>;
  ping(): Promise<unknown>;
}

let client: Redis | null = null;

// Dibuat saat pertama dipakai (bukan saat import) agar `next build` tidak gagal bila env belum ada.
export function getRedis(): RedisLike {
  if (!client) {
    const { url, token } = getRedisConfig();
    client = new Redis({ url, token });
  }
  return client as unknown as RedisLike;
}
