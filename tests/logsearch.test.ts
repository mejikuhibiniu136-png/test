import type IORedis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { exportStream, matches, parseBound, parseQuery, searchLogs } from '@/lib/logSearch';
import { KEYS } from '@/lib/keys';
import type { RedisLike } from '@/lib/redis';
import type { LogEntry } from '@/types';
import { connectTestRedis } from './helpers/redis';

const log = (i: number, o: Partial<LogEntry> = {}, payload: Record<string, unknown> = {}): LogEntry => ({
  id: `id${String(i).padStart(4, '0')}`, game: 'g', gameName: 'Anime Dice', eventType: 'Win', format: 'json', bytes: 1, processingTimeMs: 1,
  receivedAt: new Date(Date.UTC(2026, 9, 1) + i * 3_600_000).toISOString(), payload: { username: `user${i % 5}`, coins: i, ...payload }, ...o,
});

describe('parseQuery / matches (murni)', () => {
  it('istilah, frasa, pengecualian, filter kolom', () => {
    expect(parseQuery('foo "bar baz" -qux event:Win user:Alice')).toEqual({ terms: ['foo', 'bar baz'], excluded: ['qux'], fields: { event: ['win'], user: ['alice'], game: [], format: [] } });
  });
  it('AND antar istilah, substring tidak peka huruf besar/kecil, pencarian ke dalam payload', () => {
    const l = log(1, {}, { note: 'Legendary Pet Hatched' });
    expect(matches(l, parseQuery('legendary hatched'), {})).toBe(true);
    expect(matches(l, parseQuery('legendary dragon'), {})).toBe(false);
    expect(matches(l, parseQuery('-legendary'), {})).toBe(false);
    expect(matches(l, parseQuery('user:user1 event:win'), {})).toBe(true);
    expect(matches(l, parseQuery('event:lose'), {})).toBe(false);
  });
  it('filter tanggal inklusif', () => {
    const l = log(0);
    expect(matches(l, parseQuery(''), { from: l.receivedAt, to: l.receivedAt })).toBe(true);
    expect(matches(l, parseQuery(''), { from: '2026-10-02T00:00:00.000Z' })).toBe(false);
  });
  it('parseBound: tanggal polos = awal/akhir hari UTC; sampah ditolak', () => {
    expect(parseBound('2026-10-17', 'from')).toBe('2026-10-17T00:00:00.000Z');
    expect(parseBound('2026-10-17', 'to')).toBe('2026-10-17T23:59:59.999Z');
    expect(parseBound('2026-13-45', 'from')).toBe('invalid');
    expect(parseBound('bukan tanggal', 'to')).toBe('invalid');
    expect(parseBound('', 'to')).toBeNull();
  });
});

const conn = await connectTestRedis();
const d = conn ? describe : describe.skip;
d('pencarian & ekspor (Redis sungguhan)', () => {
  let redis: RedisLike; let raw: IORedis;
  beforeAll(() => { redis = conn!.redis; raw = conn!.raw; });
  afterAll(async () => { await raw?.flushdb(); raw?.disconnect(); });
  beforeEach(async () => {
    await raw.flushdb();
    // LPUSH-style: terbaru di depan, seperti penulisan log sebenarnya
    const all = Array.from({ length: 120 }, (_, i) => log(i, i % 10 === 0 ? { eventType: 'Lose' } : {}, i === 57 ? { note: 'Mythic "Dragon" =cmd' } : {}));
    await raw.lpush(KEYS.streamLogs, ...all.map((l) => JSON.stringify(l)));
  });

  it('paginasi keyset: tanpa duplikat/terlewat dan stabil walau log baru masuk di tengah', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let injected = false;
    do {
      const r = await searchLogs(redis, 'all', { q: 'event:win' }, { limit: 25, cursor });
      seen.push(...r.data.map((l) => l.id));
      if (!injected) { await raw.lpush(KEYS.streamLogs, JSON.stringify(log(500))); injected = true; } // log lebih baru muncul
      cursor = r.nextCursor;
    } while (cursor);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toHaveLength(108); // 120 - 12 Lose (i%10==0 -> 0,10,...,110)
    expect([...seen]).toEqual([...seen].sort().reverse()); // receivedAt menurun
  });

  it('mencari di payload dan menyaring tanggal', async () => {
    expect((await searchLogs(redis, 'all', { q: 'mythic dragon' })).matched).toBe(1);
    const day = await searchLogs(redis, 'all', { from: '2026-10-02T00:00:00.000Z', to: '2026-10-02T23:59:59.999Z' }, { limit: 200 });
    expect(day.data).toHaveLength(24);
  });

  it('ekspor streaming CSV: mengikuti filter, BOM, tanpa CRLF penutup, sel berawalan = dinetralkan', async () => {
    const bytes = new Uint8Array(await new Response(exportStream(redis, 'all', { q: 'mythic' }, 'csv')).arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // BOM agar Excel membaca UTF-8
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes).replace(/^\uFEFF/, '');
    expect(text.startsWith('"receivedAt",')).toBe(true);
    const lines = text.split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("Mythic");
    expect(lines[1]).not.toMatch(/,=cmd/);
  });

  it('ekspor JSON valid (array) dan NDJSON per baris; hasil kosong tetap valid', async () => {
    const json = JSON.parse(await new Response(exportStream(redis, 'all', { q: 'event:lose' }, 'json')).text());
    expect(json).toHaveLength(12);
    const nd = (await new Response(exportStream(redis, 'all', { q: 'event:lose' }, 'ndjson')).text()).trim().split('\n');
    expect(nd).toHaveLength(12);
    expect(JSON.parse(nd[0]).eventType).toBe('Lose');
    expect(JSON.parse(await new Response(exportStream(redis, 'all', { q: 'tidak-ada-sama-sekali' }, 'json')).text())).toEqual([]);
  });
});
