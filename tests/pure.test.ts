import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanGameName, slugify } from '@/lib/slug';
import { parsePayload } from '@/lib/ingest/parse';
import { detectEventType, detectGameName, isAccountStatus } from '@/lib/ingest/detect';
import { parseUserAgent, readGeo } from '@/lib/device';
import { sanitizeDeep } from '@/lib/sanitize';
import { getAccountState, mergeAccount } from '@/lib/accounts';
import { getEnvReport, getJwtSecret, getRedisConfig, getAdminConfig, ConfigError } from '@/lib/env';
import { clearableLogKeys, generateApiKey, verifyHmacSignature } from '@/lib/keys';

const enc = (s: string) => new TextEncoder().encode(s);

describe('slug', () => {
  it('menghasilkan slug aman untuk key Redis', () => {
    expect(slugify('Anime Dice')).toBe('anime-dice');
    expect(slugify('  Blox Fruits: Update 24!! ')).toBe('blox-fruits-update-24');
    expect(slugify('game:../../users:account:admin')).toBe('game-users-account-admin');
    expect(slugify('Pokémon Café')).toBe('pokemon-cafe');
    expect(slugify('日本語')).toMatch(/^g-[0-9a-f]{8}$/);
    expect(slugify('a'.repeat(200)).length).toBeLessThanOrEqual(48);
  });
  it('cleanGameName menolak nilai kosong / bukan teks', () => {
    expect(cleanGameName('  ')).toBeNull();
    expect(cleanGameName({})).toBeNull();
    expect(cleanGameName(12345)).toBe('12345');
    expect(cleanGameName('x')).toBeNull();
  });
});

describe('parsePayload', () => {
  it('JSON object', async () => {
    const r = await parsePayload(enc('{"game_name":"Alpha","n":1}'), 'application/json');
    expect(r.format).toBe('json');
    expect(r.data).toEqual({ game_name: 'Alpha', n: 1 });
  });
  it('JSON array dibungkus', async () => {
    const r = await parsePayload(enc('[1,2]'), 'application/json');
    expect(r.data).toEqual({ data: [1, 2] });
  });
  it('JSON dengan content-type salah tetap terbaca', async () => {
    expect((await parsePayload(enc('{"a":1}'), 'text/plain')).format).toBe('json');
    expect((await parsePayload(enc('{"a":1}'), null)).format).toBe('json');
  });
  it('JSON rusak disimpan sebagai teks, tidak dibuang', async () => {
    const r = await parsePayload(enc('{"a":'), 'application/json');
    expect(r.format).toBe('text');
    expect(r.data).toEqual({ text: '{"a":' });
  });
  it('URL-encoded, kunci berulang menjadi array', async () => {
    const r = await parsePayload(enc('game=Foo&tag=a&tag=b&x=%C3%A9'), 'application/x-www-form-urlencoded');
    expect(r.format).toBe('urlencoded');
    expect(r.data).toEqual({ game: 'Foo', tag: ['a', 'b'], x: 'é' });
  });
  it('URL-encoded tanpa content-type dikenali dari bentuknya', async () => {
    expect((await parsePayload(enc('a=1&b=2'), null)).format).toBe('urlencoded');
  });
  it('form-data: field teks dan metadata file (isi file tidak disimpan)', async () => {
    const form = new FormData();
    form.set('source', 'Bot X');
    form.set('file', new Blob(['rahasia'], { type: 'text/plain' }), 'a.txt');
    const req = new Request('http://x', { method: 'POST', body: form });
    const bytes = new Uint8Array(await req.arrayBuffer());
    const r = await parsePayload(bytes, req.headers.get('content-type'));
    expect(r.format).toBe('form-data');
    expect(r.data.source).toBe('Bot X');
    expect(r.data.file).toEqual({ filename: 'a.txt', size: 7, type: 'text/plain' });
    expect(JSON.stringify(r.data)).not.toContain('rahasia');
  });
  it('payload_json (gaya Discord) diangkat ke level atas', async () => {
    const form = new FormData();
    form.set('payload_json', JSON.stringify({ username: 'Anime Dice', content: 'hi' }));
    form.set('extra', '1');
    const req = new Request('http://x', { method: 'POST', body: form });
    const r = await parsePayload(new Uint8Array(await req.arrayBuffer()), req.headers.get('content-type'));
    expect(r.data).toMatchObject({ username: 'Anime Dice', content: 'hi', extra: '1' });
    expect(r.data.payload_json).toBeUndefined();
  });
  it('teks mentah dan body kosong', async () => {
    expect((await parsePayload(enc('halo dunia'), 'text/plain')).data).toEqual({ text: 'halo dunia' });
    expect((await parsePayload(new Uint8Array(0), null)).format).toBe('empty');
  });
  it('kunci berbahaya dibuang', async () => {
    const r = await parsePayload(enc('{"__proto__":{"x":1},"constructor":2,"ok":true}'), 'application/json');
    expect(Object.keys(r.data)).toEqual(['ok']);
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });
});

describe('detect', () => {
  const h = new Headers();
  const q = new URLSearchParams();
  it('membaca kunci game dengan prioritas', () => {
    expect(detectGameName({ game_name: 'Alpha', source: 'Beta' }, h, q)).toBe('Alpha');
    expect(detectGameName({ source: 'Beta', game: 'Gamma' }, h, q)).toBe('Gamma');
    expect(detectGameName({ gameName: 'Zeta' }, h, q)).toBe('Zeta');
    expect(detectGameName({ GAME_NAME: 'Upper' }, h, q)).toBe('Upper');
  });
  it('kunci bersarang dan objek {name}', () => {
    expect(detectGameName({ data: { game_name: 'Deep' } }, h, q)).toBe('Deep');
    expect(detectGameName({ game: { name: 'Obj' } }, h, q)).toBe('Obj');
  });
  it('fallback ke header, query, pengirim webhook chat, lalu default', () => {
    expect(detectGameName({}, new Headers({ 'x-game-name': 'Hd' }), q)).toBe('Hd');
    expect(detectGameName({}, h, new URLSearchParams('game=Qs'))).toBe('Qs');
    expect(detectGameName({ username: 'Anime Dice', content: 'x' }, h, q)).toBe('Anime Dice');
    expect(detectGameName({ username: 'player1' }, h, q)).toBeNull(); // bukan webhook chat
    expect(detectGameName({}, h, q, 'Anime Dice')).toBe('Anime Dice');
  });
  it('event type', () => {
    expect(detectEventType(h, { embeds: [{ title: 'New Unit!' }] })).toBe('New Unit!');
    expect(detectEventType(new Headers({ 'x-github-event': 'push' }), {})).toBe('push');
    expect(detectEventType(h, { event: 'Online' })).toBe('Online');
    expect(detectEventType(h, {})).toBe('Webhook');
  });
  it('status akun hanya jika ditandai eksplisit', () => {
    expect(isAccountStatus({ type: 'account_status' })).toBe(true);
    expect(isAccountStatus({ username: 'bot' })).toBe(false);
  });
});

describe('device', () => {
  const cases: [string, string, string, string][] = [
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36', 'Windows', 'Chrome', 'desktop'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0', 'Windows', 'Edge', 'desktop'],
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36', 'Android', 'Chrome', 'mobile'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1', 'iOS', 'Safari', 'mobile'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.0.0 Mobile/15E148 Safari/604.1', 'iOS', 'Chrome', 'mobile'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15', 'macOS', 'Safari', 'desktop'],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0', 'Linux', 'Firefox', 'desktop'],
    ['Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36', 'Android', 'Samsung Internet', 'mobile'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 OPR/111.0.0.0', 'Windows', 'Opera', 'desktop'],
    ['Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1', 'iOS', 'Safari', 'tablet'],
    ['curl/8.5.0', 'Unknown', 'curl', 'bot'],
  ];
  it.each(cases)('UA %#', (ua, os, browser, type) => {
    expect(parseUserAgent(ua)).toEqual({ os, browser, deviceType: type });
  });
  it('UA kosong', () => expect(parseUserAgent('').deviceType).toBe('unknown'));
  it('geolokasi Vercel: city di-decode', () => {
    const g = readGeo(new Headers({ 'x-vercel-ip-city': 'S%C3%A3o%20Paulo', 'x-vercel-ip-country': 'BR', 'x-vercel-ip-country-region': 'SP' }));
    expect(g).toEqual({ city: 'São Paulo', region: 'SP', country: 'BR' });
    expect(readGeo(new Headers())).toEqual({ city: null, region: null, country: null });
  });
});

describe('sanitize & akun', () => {
  it('batas kedalaman dan karakter kontrol', () => {
    let deep: Record<string, unknown> = { v: 1 };
    for (let i = 0; i < 20; i += 1) deep = { n: deep };
    expect(JSON.stringify(sanitizeDeep(deep)).length).toBeLessThan(200);
    expect(sanitizeDeep({ a: 'x\u0000y' }).a).toBe('xy');
  });
  it('status ONLINE/STALLED/OFFLINE', () => {
    const now = Date.now();
    const at = (s: number) => ({ status: 'ONLINE' as const, lastUpdate: new Date(now - s * 1000).toISOString() });
    expect(getAccountState(at(10), now)).toBe('ONLINE');
    expect(getAccountState(at(35), now)).toBe('STALLED');
    expect(getAccountState(at(50), now)).toBe('OFFLINE');
  });
  it('mergeAccount: sesi baru, heartbeat, offline', () => {
    const t0 = Date.parse('2026-01-01T00:00:00Z');
    const first = mergeAccount(null, { username: 'u', event: 'Online' }, { nowMs: t0 });
    expect(first.newSession).toBe(true);
    const hb = mergeAccount(first.account, { username: 'u', event: 'Heartbeat' }, { nowMs: t0 + 20_000 });
    expect(hb.newSession).toBe(false);
    expect(hb.account.rev).toBe(2);
    expect(hb.account.timestamp).toBe(first.account.timestamp);
    const off = mergeAccount(hb.account, { username: 'u', event: 'Offline', state: 'OFFLINE' }, { nowMs: t0 + 40_000 });
    expect(off.account.state).toBe('OFFLINE');
    const back = mergeAccount(off.account, { username: 'u', event: 'Online' }, { nowMs: t0 + 60_000 });
    expect(back.newSession).toBe(true);
  });
});

describe('env', () => {
  it('melaporkan variabel yang belum ada', () => {
    expect(() => getRedisConfig({})).toThrow(ConfigError);
    try {
      getRedisConfig({});
    } catch (e) {
      expect((e as ConfigError).missing).toEqual(['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']);
    }
    expect(() => getJwtSecret({})).toThrow(/JWT_SECRET/);
    expect(() => getJwtSecret({ JWT_SECRET: 'pendek' })).toThrow(/terlalu pendek/);
    expect(() => getAdminConfig({ ADMIN_USERNAME: 'a' })).toThrow(/ADMIN_PASSWORD_HASH/);
  });
  it('alias KV_* dari integrasi Vercel diterima', () => {
    expect(getRedisConfig({ KV_REST_API_URL: 'https://x', KV_REST_API_TOKEN: 't' })).toEqual({ url: 'https://x', token: 't' });
    expect(getRedisConfig({ UPSTASH_REDIS_REST_URL: 'https://u', UPSTASH_REDIS_REST_TOKEN: 'a', KV_REST_API_URL: 'https://k', KV_REST_API_TOKEN: 'b' }).url).toBe('https://u');
  });
  it('laporan env menandai hash yang salah format tanpa membocorkan nilai', () => {
    const r = getEnvReport({ SUPERADMIN_PASSWORD_HASH: 'argon2idsalah', JWT_SECRET: 'x'.repeat(40) });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain('argon2idsalah');
    expect(r.required.find((x) => x.name === 'SUPERADMIN_PASSWORD_HASH')?.note).toMatch(/\\\$/);
  });
});

describe('keys', () => {
  it('daftar key yang boleh dihapus Clear Logs tidak pernah memuat users:*', () => {
    const all = clearableLogKeys(['a', 'b'], 'all');
    expect(all).toEqual(['logs:stream', 'game:a:logs', 'game:b:logs']);
    expect(all.some((k) => k.startsWith('users:'))).toBe(false);
    expect(clearableLogKeys([], { game: 'x' })).toEqual(['game:x:logs']);
  });
  it('verifyHmacSignature: cocok hanya dengan secret & body yang benar', () => {
    const secret = 'rahasia-webhook';
    const body = new TextEncoder().encode('{"a":1}');
    const sig = createHmac('sha256', secret).update(body).digest('hex');
    expect(verifyHmacSignature(body, sig, secret)).toBe(true);
    expect(verifyHmacSignature(body, `sha256=${sig}`, secret)).toBe(true);
    expect(verifyHmacSignature(body, sig, 'secret-salah')).toBe(false);
    expect(verifyHmacSignature(body, null, secret)).toBe(false);
  });
  it('generateApiKey menghasilkan kunci unik berprefiks', () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a).not.toBe(b);
    expect(a.startsWith('dbde_')).toBe(true);
  });
});

describe('crypto (AES-256-GCM)', () => {
  const ORIGINAL = process.env.ENCRYPTION_KEY;
  beforeEach(() => { process.env.ENCRYPTION_KEY = '11'.repeat(32); });
  afterEach(() => { process.env.ENCRYPTION_KEY = ORIGINAL; });

  it('round-trip: decrypt(encrypt(x)) === x, format iv:authTag:data', async () => {
    const { encrypt, decrypt, isCiphertext } = await import('@/lib/crypto');
    const ciphertext = encrypt('rahasia-super');
    expect(ciphertext.split(':')).toHaveLength(3);
    expect(isCiphertext(ciphertext)).toBe(true);
    expect(decrypt(ciphertext)).toBe('rahasia-super');
  });

  it('dua enkripsi dari plaintext sama menghasilkan ciphertext berbeda (IV acak)', async () => {
    const { encrypt } = await import('@/lib/crypto');
    expect(encrypt('x')).not.toBe(encrypt('x'));
  });

  it('decrypt menolak ciphertext yang diubah (auth tag gagal)', async () => {
    const { encrypt, decrypt } = await import('@/lib/crypto');
    const c = encrypt('data-penting');
    const tampered = c.slice(0, -1) + (c.endsWith('0') ? '1' : '0');
    expect(() => decrypt(tampered)).toThrow();
  });
});
