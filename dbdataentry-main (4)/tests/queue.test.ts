// Antrean ingest at-least-once dengan Redis SUNGGUHAN (script Lua dijalankan server Redis).
import type IORedis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { drainQueue } from '@/lib/ingest/drain';
import { handleIngest } from '@/lib/ingest/handler';
import { ack, buildItem, claim, enqueue, nack, purgeDead, readQueueStats, reclaimExpired, retryDead, type QueueItem } from '@/lib/ingest/queue';
import { KEYS } from '@/lib/keys';
import type { RedisLike } from '@/lib/redis';
import { __resetRuntimeSettingsCache, writeSetting } from '@/lib/settings';
import { connectTestRedis } from './helpers/redis';

const conn = await connectTestRedis();
const d = conn ? describe : describe.skip;
let redis: RedisLike;
let raw: IORedis;

const item = (n: number, extra: Partial<Pick<QueueItem, 'defaultGame' | 'forceAccount'>> = {}): QueueItem =>
  buildItem({ bytes: new TextEncoder().encode(JSON.stringify({ game_name: 'Queue Game', n })), contentType: 'application/json', headers: new Headers(), url: new URL('http://t/api/receiver/universal'), ...extra });

const post = (body: unknown, url = 'http://t/api/receiver/universal', extra: Record<string, string> = {}) =>
  new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '7.7.7.7', ...extra }, body: JSON.stringify(body) });

d('antrean ingest (Redis sungguhan)', () => {
  beforeAll(() => { redis = conn!.redis; raw = conn!.raw; });
  afterAll(async () => { await raw?.flushdb(); raw?.disconnect(); });
  beforeEach(async () => { await raw.flushdb(); __resetRuntimeSettingsCache(); });

  it('FIFO: urutan masuk = urutan klaim; klaim memindahkan ke inflight; ack membersihkan', async () => {
    for (let i = 0; i < 5; i += 1) await enqueue(redis, item(i));
    const got = await claim(redis, 3);
    expect(got.map((r) => JSON.parse(Buffer.from(JSON.parse(r).bodyB64, 'base64').toString()).n)).toEqual([0, 1, 2]);
    expect(await raw.llen(KEYS.queuePending)).toBe(2);
    expect(await raw.zcard(KEYS.queueInflight)).toBe(3);
    expect(await ack(redis, got)).toBe(3);
    expect(await raw.zcard(KEYS.queueInflight)).toBe(0);
  });

  it('backpressure: melewati batas kedalaman ditolak dan dihitung', async () => {
    for (let i = 0; i < 3; i += 1) expect((await enqueue(redis, item(i), 3)).ok).toBe(true);
    expect(await enqueue(redis, item(9), 3)).toEqual({ ok: false, reason: 'full' });
    expect(await raw.llen(KEYS.queuePending)).toBe(3);
    expect((await readQueueStats(redis)).rejected).toBe(1);
  });

  it('dua pengklaim serentak tidak pernah mendapat item yang sama', async () => {
    for (let i = 0; i < 100; i += 1) await enqueue(redis, item(i));
    const [a, b] = await Promise.all([claim(redis, 60), claim(redis, 60)]);
    expect(a.length + b.length).toBe(100);
    expect(new Set([...a, ...b]).size).toBe(100);
  });

  it('fungsi mati di tengah proses: lease habis -> item kembali (attempts+1), lalu dead-letter di batas percobaan', async () => {
    await enqueue(redis, item(1));
    const t0 = Date.now();
    expect(await claim(redis, 10, t0, 1000)).toHaveLength(1); // diklaim lalu "proses mati": tidak ada ack
    expect(await reclaimExpired(redis, t0 + 500, 3)).toEqual({ retried: 0, dead: 0 }); // lease belum habis
    expect(await reclaimExpired(redis, t0 + 1500, 3)).toEqual({ retried: 1, dead: 0 });
    expect(JSON.parse((await raw.lrange(KEYS.queuePending, 0, 0))[0]).attempts).toBe(1);
    await claim(redis, 10, t0 + 2000, 1000);
    expect(await reclaimExpired(redis, t0 + 4000, 3)).toEqual({ retried: 1, dead: 0 });
    await claim(redis, 10, t0 + 5000, 1000);
    expect(await reclaimExpired(redis, t0 + 7000, 3)).toEqual({ retried: 0, dead: 1 });
    expect(await raw.llen(KEYS.queueDead)).toBe(1);
    expect(await raw.llen(KEYS.queuePending)).toBe(0);
  });

  it('nack: gagal -> retry; setelah batas -> dead; item yang sudah hilang -> gone', async () => {
    await enqueue(redis, item(1));
    let [r] = await claim(redis, 1);
    expect(await nack(redis, r, 2)).toBe('retry');
    [r] = await claim(redis, 1);
    expect(await nack(redis, r, 2)).toBe('dead');
    expect(await nack(redis, r, 2)).toBe('gone');
  });

  it('item beracun tidak menyumbat antrean: akhirnya dead-letter, item sehat tetap diproses', async () => {
    await enqueue(redis, item(1, { forceAccount: false }));
    await enqueue(redis, item(2));
    const seen: number[] = [];
    const handler = vi.fn(async (_r: RedisLike, it: QueueItem) => {
      const n = JSON.parse(Buffer.from(it.bodyB64, 'base64').toString()).n;
      if (n === 1) throw new Error('beracun');
      seen.push(n);
    });
    const report = await drainQueue(redis, { handler, budgetMs: 5000 });
    expect(seen).toEqual([2]);
    expect(report.dead).toBe(1);
    const s = await readQueueStats(redis);
    expect(s).toMatchObject({ depth: 0, inflight: 0, dead: 1, processed: 1 });
    expect(await retryDead(redis)).toBe(1);
    expect(JSON.parse((await raw.lrange(KEYS.queuePending, 0, 0))[0]).attempts).toBe(0);
    expect(await purgeDead(redis)).toBe(0);
  });

  it('hanya satu pengurus pada satu waktu; kunci dilepas setelah selesai', async () => {
    await enqueue(redis, item(1));
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => { release = r; });
    const first = drainQueue(redis, { handler: async () => { await gate; }, budgetMs: 5000 });
    await new Promise((r) => setTimeout(r, 50));
    expect(await drainQueue(redis)).toMatchObject({ locked: false, processed: 0 });
    release();
    expect((await first).processed).toBe(1);
    expect(await raw.exists(KEYS.queueLock)).toBe(0);
    expect((await drainQueue(redis)).locked).toBe(true);
  });

  it('buildItem membuang ?key= (kredensial) dan hanya meneruskan header deteksi', async () => {
    const it = buildItem({ bytes: new Uint8Array(0), contentType: null, headers: new Headers({ 'x-game-name': 'G', authorization: 'Bearer rahasia', cookie: 'a=b' }), url: new URL('http://t/x?game=Z&key=SECRET&a=1') });
    expect(it.query).toBe('game=Z&a=1');
    expect(it.headers).toEqual({ 'x-game-name': 'G' });
    expect(JSON.stringify(it)).not.toContain('SECRET');
    expect(JSON.stringify(it)).not.toContain('rahasia');
  });

  describe('handler mode antrean (end-to-end)', () => {
    it('mode mati (bawaan): jalur langsung 200 seperti sebelumnya', async () => {
      const res = await handleIngest(post({ game_name: 'Queue Game', a: 1 }), {}, { redis, scheduleDrain: () => undefined });
      expect(res.status).toBe(200);
      expect((await res.json()).stored).toBe(true);
      expect(await raw.llen(KEYS.queuePending)).toBe(0);
    });

    it('mode nyala: 202 segera, belum ada log; setelah drain log tertulis lengkap dan metadata tabel dibuat', async () => {
      await writeSetting(redis, 'INGEST_QUEUE_ENABLED', true);
      const res = await handleIngest(post({ game_name: 'Queue Game', event: 'Win', username: 'p1' }, 'http://t/api/receiver/universal?key=SECRET'), {}, { redis, scheduleDrain: () => undefined });
      expect(res.status).toBe(202);
      expect(await res.json()).toMatchObject({ success: true, queued: true, stored: false, depth: 1 });
      expect(await raw.llen(KEYS.streamLogs)).toBe(0);
      expect(await raw.lrange(KEYS.queuePending, 0, -1).then((l) => l.join(''))).not.toContain('SECRET');

      expect((await drainQueue(redis)).processed).toBe(1);
      const log = JSON.parse((await raw.lrange(KEYS.streamLogs, 0, 0))[0]);
      expect(log).toMatchObject({ gameName: 'Queue Game', eventType: 'Win', payload: { username: 'p1' } });
      expect(await raw.hget(KEYS.gamesCounts, 'queue-game')).toBe('1');
    });

    it('payload melebihi batas item antrean tetap diproses langsung (200)', async () => {
      await writeSetting(redis, 'INGEST_QUEUE_ENABLED', true);
      const res = await handleIngest(post({ game_name: 'Queue Game', blob: 'x'.repeat(40_000) }), {}, { redis, scheduleDrain: () => undefined });
      expect(res.status).toBe(200);
      expect(await raw.llen(KEYS.queuePending)).toBe(0);
    });

    it('antrean penuh: 503 + Retry-After (klien pengirim akan mengulang)', async () => {
      await writeSetting(redis, 'INGEST_QUEUE_ENABLED', true);
      process.env.QUEUE_MAX_DEPTH = '100';
      try {
        for (let i = 0; i < 100; i += 1) await enqueue(redis, item(i), 100);
        const res = await handleIngest(post({ game_name: 'Queue Game' }), {}, { redis, scheduleDrain: () => undefined });
        expect(res.status).toBe(503);
        expect(res.headers.get('retry-after')).toBe('10');
      } finally { delete process.env.QUEUE_MAX_DEPTH; }
    });

    it('lonjakan 300 event serentak: semua diterima (202), semua terproses tepat sekali', async () => {
      await writeSetting(redis, 'INGEST_QUEUE_ENABLED', true);
      const responses = await Promise.all(Array.from({ length: 300 }, (_, i) => handleIngest(post({ game_name: 'Burst Game', event: 'tick', i }, 'http://t/api/receiver/universal', { 'x-forwarded-for': `10.0.${Math.floor(i / 250)}.${i % 250}` }), {}, { redis, scheduleDrain: () => undefined })));
      expect(responses.every((r) => r.status === 202)).toBe(true);
      expect((await readQueueStats(redis)).depth).toBe(300);
      let processed = 0;
      for (let i = 0; i < 20 && processed < 300; i += 1) processed += (await drainQueue(redis, { budgetMs: 20_000 })).processed;
      expect(processed).toBe(300);
      expect(await raw.hget(KEYS.gamesCounts, 'burst-game')).toBe('300');
      expect(await raw.zcard(KEYS.queueInflight)).toBe(0);
    });
  });
});
