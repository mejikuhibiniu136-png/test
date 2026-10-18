// Unit test untuk logika murni HWID & Control: komputasi hash, ikatan HWID, watermark,
// rekaman kebocoran, dan perintah kontrol (set/get/clear/list). Tidak menyentuh Redis sungguhan.
import { describe, expect, it } from 'vitest';
import { computeHwidHash, bindHwid, readBinding, issueWatermark, readDownloadRecord, recordLeak, readLeaks } from '@/lib/hwid';
import { clearControl, getControl, listControls, setControl } from '@/lib/control';
import { renderHwidScript } from '@/lib/hwid/scriptTemplate';
import type { RedisLike } from '@/lib/redis';

// Mock Redis dalam-memori: menerapkan subset perintah yang dipakai modul hwid & control.
// TTL `ex` disimulasikan lewat cap waktu; get() mengembalikan null bila kedaluwarsa.
class MemoryRedis implements RedisLike {
  private kv = new Map<string, { value: string; expiresAt?: number }>();
  private lists = new Map<string, string[]>();
  private hashes = new Map<string, Record<string, string>>();
  private counters = new Map<string, number>();

  get = async (key: string) => {
    const e = this.kv.get(key);
    if (!e) return null;
    if (e.expiresAt && e.expiresAt < Date.now()) { this.kv.delete(key); return null; }
    return e.value;
  };
  set = async (key: string, value: unknown, opts?: { nx?: boolean; ex?: number }) => {
    if (opts?.nx && this.kv.has(key)) return null;
    this.kv.set(key, { value: String(value), expiresAt: opts?.ex ? Date.now() + opts.ex * 1000 : undefined });
    return 'OK';
  };
  del = async (...keys: string[]) => { let n = 0; for (const k of keys) { if (this.kv.delete(k) || this.hashes.delete(k) || this.lists.delete(k)) n++; } return n; };
  incr = async (key: string) => { const v = (this.counters.get(key) ?? 0) + 1; this.counters.set(key, v); return v; };
  lpush = async (key: string, ...values: string[]) => { const l = this.lists.get(key) ?? []; l.unshift(...values); this.lists.set(key, l); return l.length; };
  ltrim = async (key: string, start: number, stop: number) => {
    const l = this.lists.get(key); if (!l) return 'OK';
    const len = l.length;
    const s = start < 0 ? Math.max(0, len + start) : start;
    const e = stop < 0 ? len + stop : stop;
    this.lists.set(key, l.slice(s, e + 1));
    return 'OK';
  };
  lrange = async (key: string, start: number, stop: number) => {
    const l = this.lists.get(key) ?? []; const len = l.length;
    const s = start < 0 ? Math.max(0, len + start) : start;
    const e = stop < 0 ? len + stop : Math.min(stop, len - 1);
    return l.slice(s, e + 1);
  };
  llen = async (key: string) => this.lists.get(key)?.length ?? 0;
  hget = async (key: string, field: string) => this.hashes.get(key)?.[field] ?? null;
  hset = async (key: string, values: Record<string, string>) => { const h = this.hashes.get(key) ?? {}; Object.assign(h, values); this.hashes.set(key, h); return Object.keys(values).length; };
  hsetnx = async (key: string, field: string, value: string) => { const h = this.hashes.get(key) ?? {}; if (field in h) return 0; h[field] = value; this.hashes.set(key, h); return 1; };
  hgetall = async (key: string) => this.hashes.get(key) ? { ...this.hashes.get(key)! } : null;
  hdel = async (key: string, ...fields: string[]) => { const h = this.hashes.get(key); if (!h) return 0; let n = 0; for (const f of fields) { if (delete h[f]) n++; } return n; };
  hlen = async (key: string) => Object.keys(this.hashes.get(key) ?? {}).length;
  hexists = async (key: string, field: string) => (field in (this.hashes.get(key) ?? {})) ? 1 : 0;
  hincrby = async (key: string, field: string, by: number) => { const h = this.hashes.get(key) ?? {}; h[field] = String(Number(h[field] ?? 0) + by); this.hashes.set(key, h); return Number(h[field]); };
  zadd = async () => 0; zrange = async () => []; zcard = async () => 0; rename = async () => 'OK';
  eval = async () => null; exists = async (...keys: string[]) => keys.filter((k) => this.kv.has(k)).length;
  expire = async () => 1; ttl = async () => -1; ping = async () => 'PONG';
}

describe('computeHwidHash', () => {
  it('deterministik: input sama -> output sama, 8 hex char', () => {
    const a = computeHwidHash(123, 456);
    const b = computeHwidHash('123', '456');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}$/);
  });
  it('input berbeda -> hash berbeda', () => {
    expect(computeHwidHash(123, 456)).not.toBe(computeHwidHash(124, 456));
    expect(computeHwidHash(123, 456)).not.toBe(computeHwidHash(123, 457));
  });
  it('cermin algoritma djb2 di Lua: template memuat seed 5381 & pengali 33', () => {
    const lua = renderHwidScript({ endpoint: 'https://x.test', leakUrl: 'https://x.test/leak', controlUrl: 'https://x.test/ctrl', accountId: 'acc', nonce: 'n', hex: 'h', key: 'k' });
    expect(lua).toContain('5381');
    expect(lua).toContain('33');
  });
});

describe('HWID bind & watermark', () => {
  it('bindHwid -> readBinding round-trip menyimpan hwidHash konsisten', async () => {
    const r = new MemoryRedis();
    const binding = await bindHwid(r, 'alice', '123', '456', 'staff');
    expect(binding.hwidHash).toBe(computeHwidHash('123', '456'));
    const read = await readBinding(r, 'alice');
    expect(read?.accountId).toBe('alice');
    expect(read?.hwidHash).toBe(binding.hwidHash);
  });
  it('issueWatermark menyimpan rekaman dengan kunci; readDownloadRecord mengembalikannya', async () => {
    const r = new MemoryRedis();
    const binding = await bindHwid(r, 'bob', '777', '888', 'staff');
    const { record, nonce, hex } = await issueWatermark(r, binding, 'staff');
    expect(nonce).toMatch(/^[0-9a-f]+$/);
    expect(hex.length).toBeGreaterThan(0);
    expect(record.key.length).toBe(24);
    const fetched = await readDownloadRecord(r, record.id);
    expect(fetched?.key).toBe(record.key);
    expect(fetched?.accountId).toBe('bob');
  });
});

describe('HWID leak recording', () => {
  it('recordLeak -> readLeaks mencantumkan kebocoran terbaru di depan', async () => {
    const r = new MemoryRedis();
    await recordLeak(r, { accountId: 'carol', expectedHwid: 'aaaa1111', detectedHwid: 'bbbb2222', reason: 'hwid_mismatch', ip: '1.2.3.4' });
    await recordLeak(r, { accountId: 'dave', expectedHwid: 'cccc3333', detectedHwid: 'dddd4444', reason: 'hwid_mismatch', ip: '5.6.7.8' });
    const leaks = await readLeaks(r, 10);
    expect(leaks).toHaveLength(2);
    expect(leaks[0].accountId).toBe('dave');
    expect(leaks[1].accountId).toBe('carol');
    expect(leaks[0].expectedHwid).toBe('cccc3333');
    expect(leaks[0].detectedHwid).toBe('dddd4444');
  });
});

describe('control commands', () => {
  it('setControl -> getControl mengembalikan perintah aktif', async () => {
    const r = new MemoryRedis();
    await setControl(r, 'eve', 'KILL', 'staff', 60);
    expect(await getControl(r, 'eve')).toBe('KILL');
  });
  it('getControl mengembalikan null bila tidak ada perintah', async () => {
    const r = new MemoryRedis();
    expect(await getControl(r, 'nobody')).toBeNull();
  });
  it('clearControl menghapus perintah dan index', async () => {
    const r = new MemoryRedis();
    await setControl(r, 'frank', 'PAUSE', 'staff', 60);
    expect(await getControl(r, 'frank')).toBe('PAUSE');
    const removed = await clearControl(r, 'frank');
    expect(removed).toBe(true);
    expect(await getControl(r, 'frank')).toBeNull();
  });
  it('listControls mendaftar perintah aktif dan membersihkan yang kedaluwarsa', async () => {
    const r = new MemoryRedis();
    await setControl(r, 'g1', 'KILL', 'staff', 60);
    await setControl(r, 'g2', 'PAUSE', 'staff', 60);
    let live = await listControls(r);
    expect(live).toHaveLength(2);
    expect(live.map((c) => c.accountId).sort()).toEqual(['g1', 'g2']);
    await r.del('control:cmd:g1');
    live = await listControls(r);
    expect(live).toHaveLength(1);
    expect(live[0].accountId).toBe('g2');
  });
});

