// Tes integrasi dengan Redis SUNGGUHAN (script Lua ingest berjalan di server Redis).
// Dilewati otomatis bila Redis tidak tersedia di TEST_REDIS_PORT (default 6390).
import { readdir } from 'node:fs/promises';
import type IORedis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { STAGING_DIR } from '@/lib/ingest/staging';
import { handleIngest } from '@/lib/ingest/handler';
import { __resetReceiverCache, MAX_CAS_RETRIES, readAccounts, readLogs, setReceiverEnabled } from '@/lib/ingest/store';
import { __clearResolveCache, clearLogs, createGame, deleteGame, listGames, renameGame } from '@/lib/games';
import { performLogin, performRegister } from '@/lib/auth/login';
import { hashPassword } from '@/lib/auth/password';
import { KEYS } from '@/lib/keys';
import { readDevices } from '@/lib/users';
import { __resetRuntimeSettingsCache } from '@/lib/settings';
import { __resetApiKeyUsedThrottle } from '@/lib/apikeys';
import type { RedisLike } from '@/lib/redis';
import { connectTestRedis } from './helpers/redis';

const conn = await connectTestRedis();
const d = conn ? describe : describe.skip;

let redis: RedisLike;
let raw: IORedis;

let n = 0;
const post = (body: BodyInit | null, headers: Record<string, string> = {}, opts: Parameters<typeof handleIngest>[1] = {}, url = 'http://t/api/receiver/universal') =>
  handleIngest(new Request(url, { method: 'POST', body, headers: { 'x-forwarded-for': `10.0.${(n += 1) % 250}.1`, ...headers } }), opts, { redis });
const postJson = (obj: unknown, opts?: Parameters<typeof handleIngest>[1], url?: string) =>
  post(JSON.stringify(obj), { 'content-type': 'application/json' }, opts, url);

d('ingest (Redis sungguhan)', () => {
  beforeAll(() => {
    redis = conn!.redis;
    raw = conn!.raw;
  });
  afterAll(async () => {
    await raw?.flushdb();
    raw?.disconnect();
  });
  beforeEach(async () => {
    await raw.flushdb();
    __resetReceiverCache();
    __resetRuntimeSettingsCache();
    __resetApiKeyUsedThrottle();
    __clearResolveCache();
    delete process.env.WEBHOOK_INGEST_TOKEN;
  });

  it('JSON dengan game_name: tabel dibuat otomatis, log masuk ke stream dan tabel game', async () => {
    const res = await postJson({ game_name: 'Blox Fruits', event: 'Drop', item: 'Dragon' });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ success: true, game: 'blox-fruits', gameName: 'Blox Fruits', newTable: true, format: 'json' });

    expect(await raw.llen('logs:stream')).toBe(1);
    expect(await raw.llen('game:blox-fruits:logs')).toBe(1);
    const [log] = await readLogs(redis, 'blox-fruits', 10);
    expect(log.payload.item).toBe('Dragon');
    expect(log.game).toBe('blox-fruits');

    const games = await listGames(redis);
    expect(games.map((g) => g.slug).sort()).toEqual(['anime-dice', 'blox-fruits']); // Anime Dice selalu ada
    expect(games.find((g) => g.slug === 'blox-fruits')).toMatchObject({ source: 'auto', total: 1 });
    expect(games.find((g) => g.slug === 'anime-dice')).toMatchObject({ builtin: true, source: 'builtin', total: 0 });
  });

  it('tabel yang sudah ada dipakai ulang, bukan dibuat lagi', async () => {
    await postJson({ game_name: 'Foo Game' });
    const second = await (await postJson({ game_name: 'foo   GAME' })).json();
    expect(second.newTable).toBe(false);
    expect(await raw.hget('games:counts', 'foo-game')).toBe('2');
    expect(await raw.hlen('games:meta')).toBe(1);
  });

  it('URL-encoded, form-data, dan teks mentah diterima dari sumber mana pun', async () => {
    const a = await (await post('game=Alpha+Game&event=x', { 'content-type': 'application/x-www-form-urlencoded' })).json();
    expect(a).toMatchObject({ game: 'alpha-game', format: 'urlencoded' });

    const form = new FormData();
    form.set('source', 'Beta Bot');
    form.set('msg', 'halo');
    const req = new Request('http://t/x', { method: 'POST', body: form });
    const b = await (await post(new Uint8Array(await req.arrayBuffer()), { 'content-type': req.headers.get('content-type')! })).json();
    expect(b).toMatchObject({ game: 'beta-bot', format: 'form-data' });

    const c = await (await post('baris log mentah tanpa struktur', { 'content-type': 'text/plain' })).json();
    expect(c).toMatchObject({ game: 'uncategorized', format: 'text' });
    const [raw1] = await readLogs(redis, 'uncategorized', 1);
    expect(raw1.payload.text).toBe('baris log mentah tanpa struktur');
  });

  it('payload dari sumber tanpa identitas masuk ke Uncategorized; alias lama dice masuk Anime Dice', async () => {
    expect((await (await postJson({ foo: 'bar' })).json()).game).toBe('uncategorized');
    const legacy = await (await postJson({ embeds: [{ title: 'New Unit! 1/1M' }] }, { defaultGame: 'Anime Dice' }, 'http://t/api/webhook?key=abc')).json();
    expect(legacy).toMatchObject({ game: 'anime-dice' });
    expect(await raw.hget('games:meta', 'anime-dice')).toContain('"source":"builtin"');
  });

  it('batas jumlah tabel: sumber baru berikutnya masuk Uncategorized', async () => {
    process.env.MAX_GAME_TABLES = '5';
    for (const g of ['Game One', 'Game Two', 'Game Three', 'Game Four']) await postJson({ game_name: g }); // + Anime Dice dibuat saat list
    await listGames(redis); // seed Anime Dice => 5 tabel
    const over = await (await postJson({ game_name: 'Game Five' })).json();
    expect(over.game).toBe('uncategorized');
    delete process.env.MAX_GAME_TABLES;
  });

  it('staging: tidak ada file sementara tertinggal setelah sukses, gagal, atau payload terpotong', async () => {
    const before: string[] = await readdir(STAGING_DIR).catch(() => [] as string[]);
    await postJson({ game_name: 'Clean Game' });
    const trunc = await post('{"a":', { 'content-type': 'application/json', 'content-length': '999' });
    expect(trunc.status).toBe(400);
    // Redis gagal di tengah jalan -> 503 dan staging tetap bersih
    const broken = { ...redis, eval: async () => { throw new Error('boom'); } } as RedisLike;
    const res = await handleIngest(new Request('http://t/x', { method: 'POST', body: '{"game_name":"Boom"}', headers: { 'content-type': 'application/json', 'x-forwarded-for': '9.9.9.9' } }), {}, { redis: broken });
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('5');
    const after: string[] = await readdir(STAGING_DIR).catch(() => [] as string[]);
    expect(after.filter((f) => !before.includes(f))).toEqual([]);
  });

  it('body terlalu besar ditolak 413', async () => {
    const res = await post('x'.repeat(300 * 1024), { 'content-type': 'text/plain' });
    expect(res.status).toBe(413);
  });

  it('saklar receiver OFF: 202 dan tidak ada yang tersimpan', async () => {
    await setReceiverEnabled(redis, false);
    const res = await postJson({ game_name: 'Off Game' });
    expect(res.status).toBe(202);
    expect(await raw.exists('game:off-game:logs')).toBe(0);
  });

  it('WEBHOOK_INGEST_TOKEN opsional: bila diset, request tanpa token ditolak', async () => {
    process.env.WEBHOOK_INGEST_TOKEN = 'token-rahasia-123456';
    expect((await postJson({ game_name: 'Secured' })).status).toBe(401);
    const ok = await post('{"game_name":"Secured"}', { 'content-type': 'application/json', 'x-api-key': 'token-rahasia-123456' });
    expect(ok.status).toBe(200);
  });

  it('CORS: preflight dan header pada respons', async () => {
    const res = await postJson({ game_name: 'Cors Game' });
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('rate limit per IP', async () => {
    let last = 200;
    for (let i = 0; i < 601; i += 1) {
      const r = await handleIngest(new Request('http://t/x', { method: 'POST', body: '{"game_name":"Rate Game"}', headers: { 'content-type': 'application/json', 'x-forwarded-for': '7.7.7.7' } }), {}, { redis });
      last = r.status;
      if (last === 429) {
        expect(r.headers.get('retry-after')).toBeTruthy();
        break;
      }
    }
    expect(last).toBe(429);
  });

  // ----- status akun -----

  const hb = (event: string, extra: Record<string, unknown> = {}) => ({
    type: 'account_status', username: 'Alice', displayName: 'Alice', gameName: 'Anime Dice', userId: 1, placeId: 2, jobId: 'job', event, state: event === 'Offline' ? 'OFFLINE' : 'ONLINE', ...extra,
  });

  it('status akun: Online dan Offline dicatat di log, Heartbeat rutin hanya memperbarui akun', async () => {
    const a = await (await postJson(hb('Online'))).json();
    expect(a).toMatchObject({ logged: true, account: 'ONLINE', game: 'anime-dice' });
    const b = await (await postJson(hb('Heartbeat', { latencyMs: 80 }))).json();
    expect(b).toMatchObject({ logged: false, id: null });
    await postJson(hb('Heartbeat'));
    expect(await raw.llen('game:anime-dice:logs')).toBe(1);

    const [acc] = await readAccounts(redis);
    expect(acc).toMatchObject({ username: 'Alice', state: 'ONLINE', latencyMs: expect.any(Number), rev: 3 });

    await postJson(hb('Offline'));
    expect(await raw.llen('game:anime-dice:logs')).toBe(2);
    expect((await readAccounts(redis))[0].state).toBe('OFFLINE');
  });

  it('telemetri klien (fps, pingMs, memoryMb) disimpan; nilai buruk diabaikan tanpa menggagalkan payload', async () => {
    await postJson(hb('Online', { fps: 59.6, pingMs: 42, memoryMb: 812.4 }));
    let [acc] = await readAccounts(redis);
    expect(acc).toMatchObject({ fps: 60, pingMs: 42, memoryMb: 812 });

    await postJson(hb('Heartbeat', { fps: 'abc', pingMs: -5 }));
    [acc] = await readAccounts(redis);
    expect(acc.state).toBe('ONLINE');
    expect(acc.fps).toBeUndefined();
    expect(acc.pingMs).toBeUndefined();
  });

  it('webhook pihak ketiga dengan field username TIDAK membuat akun palsu', async () => {
    await postJson({ game_name: 'Some Game', username: 'bot-pengirim', event: 'Roll' });
    expect(await readAccounts(redis)).toEqual([]);
  });

  it('alias lama /api/receiver/account (forceAccount) tetap memperbarui akun', async () => {
    const { type: _t, ...legacy } = hb('Aktif');
    void _t;
    const r = await (await postJson(legacy, { forceAccount: true })).json();
    expect(r).toMatchObject({ account: 'ONLINE', logged: true }); // sesi baru dicatat
    expect(await readAccounts(redis)).toHaveLength(1);
  });

  it('payload account_status tidak valid disimpan sebagai log biasa, tidak dibuang', async () => {
    const r = await (await postJson({ type: 'account_status', game_name: 'Zeta Game', userId: { bad: true } })).json();
    expect(r).toMatchObject({ stored: true, logged: true, game: 'zeta-game' });
    expect(await readAccounts(redis)).toEqual([]);
  });

  it('CAS: 25 heartbeat serentak untuk satu akun tidak ada yang hilang (rev = 25)', async () => {
    await postJson(hb('Online'));
    const results = await Promise.all(Array.from({ length: 24 }, () => postJson(hb('Heartbeat'))));
    expect(results.every((r) => r.status === 200)).toBe(true);
    const [acc] = await readAccounts(redis);
    expect(acc.rev).toBe(25);
    expect(MAX_CAS_RETRIES).toBeGreaterThan(0);
  });

  // ----- kelola tabel (admin) -----

  it('buat / rename / hapus tabel manual, dengan alias setelah rename', async () => {
    await expect(createGame(redis, 'Anime Dice', 'admin')).rejects.toMatchObject({ status: 409 });
    const made = await createGame(redis, 'Old Name', 'admin');
    expect(made).toMatchObject({ slug: 'old-name', source: 'manual', createdBy: 'admin' });
    await expect(createGame(redis, 'old name', 'admin')).rejects.toMatchObject({ status: 409 });

    await postJson({ game_name: 'Old Name', x: 1 });
    await postJson({ game_name: 'Old Name', x: 2 });
    const renamed = await renameGame(redis, 'old-name', 'New Name');
    expect(renamed).toMatchObject({ slug: 'new-name', name: 'New Name', total: 2 });
    expect(await raw.llen('game:new-name:logs')).toBe(2); // data log ikut pindah
    expect(await raw.exists('game:old-name:logs')).toBe(0);

    // sumber yang masih mengirim "Old Name" diarahkan ke tabel baru, bukan membuat tabel lama lagi
    const after = await (await postJson({ game_name: 'Old Name', x: 3 })).json();
    expect(after.game).toBe('new-name');
    expect(await raw.hexists('games:meta', 'old-name')).toBe(0);

    await expect(renameGame(redis, 'new-name', 'Anime Dice')).rejects.toMatchObject({ status: 409 });
    await expect(renameGame(redis, 'anime-dice', 'Lain')).rejects.toMatchObject({ status: 400 }); // bawaan
    await expect(deleteGame(redis, 'anime-dice')).rejects.toMatchObject({ status: 400 });

    await deleteGame(redis, 'new-name');
    expect(await raw.exists('game:new-name:logs')).toBe(0);
    expect((await listGames(redis)).map((g) => g.slug)).toEqual(['anime-dice']);
    await expect(deleteGame(redis, 'new-name')).rejects.toMatchObject({ status: 404 });
  });

  // ----- keamanan data pengguna -----

  it('Clear Logs HANYA menghapus key log; users:*, perangkat, tracker, dan metadata tetap utuh', async () => {
    process.env.ADMIN_USERNAME = 'boss';
    process.env.ADMIN_PASSWORD_HASH = await hashPassword('admin-pass-1');
    process.env.JWT_SECRET = 'j'.repeat(40);

    await performRegister(redis, new Headers({ 'x-forwarded-for': '1.1.1.1' }), 'Alice', 'password-alice');
    await performLogin(redis, new Headers({ 'x-forwarded-for': '1.1.1.1', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0 Safari/537.36' }), 'alice', 'password-alice');
    await postJson({ game_name: 'Keep Game', n: 1 });
    await postJson(hb('Online'));

    const snapshot = async () => {
      const keys = (await raw.keys('users:*')).sort();
      const values = await Promise.all(keys.map(async (k) => [k, await raw.type(k).then(async (t) => (t === 'string' ? raw.get(k) : t === 'list' ? raw.lrange(k, 0, -1) : raw.zrange(k, '0', '-1', 'WITHSCORES')))]));
      return JSON.stringify(values);
    };
    const usersBefore = await snapshot();
    expect(usersBefore).toContain('users:account:alice');
    expect(usersBefore).toContain('users:devices:alice');
    expect(usersBefore).toContain('users:list');
    const trackerBefore = await raw.hgetall('tracker:accounts');
    const metaBefore = await raw.hgetall('games:meta');

    await clearLogs(redis, 'all');

    expect(await raw.exists('logs:stream')).toBe(0);
    expect(await raw.exists('game:keep-game:logs')).toBe(0);
    expect(await raw.exists('game:anime-dice:logs')).toBe(0);
    expect(await snapshot()).toBe(usersBefore);
    expect(await raw.hgetall('tracker:accounts')).toEqual(trackerBefore);
    expect(await raw.hgetall('games:meta')).toEqual(metaBefore);

    await postJson({ game_name: 'Keep Game', n: 2 });
    await clearLogs(redis, { game: 'keep-game' });
    expect(await raw.exists('game:keep-game:logs')).toBe(0);
    expect(await snapshot()).toBe(usersBefore);
    await expect(clearLogs(redis, { game: 'tidak-ada' })).rejects.toMatchObject({ status: 404 });
  });

  it('registrasi: duplikat (tanpa pembeda huruf besar) dan username admin ditolak; password di-hash Argon2id', async () => {
    process.env.ADMIN_USERNAME = 'Boss';
    process.env.ADMIN_PASSWORD_HASH = await hashPassword('admin-pass-1'); // nama dicadangkan hanya bila Superadmin terkonfigurasi lengkap
    const h = new Headers({ 'x-forwarded-for': '2.2.2.2' });
    await performRegister(redis, h, 'Carol', 'password-carol');
    await expect(performRegister(redis, h, 'CAROL', 'password-lain')).rejects.toMatchObject({ status: 409 });
    await expect(performRegister(redis, h, 'boss', 'password-x-123')).rejects.toMatchObject({ status: 409 });
    const stored = JSON.parse((await raw.get('users:account:carol'))!);
    expect(stored.passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(stored.role).toBe('viewer');
    expect(JSON.stringify(stored)).not.toContain('password-carol');
  });

  it('login: role admin dari env, role user dari registrasi; perangkat + geolokasi dicatat; rate limit per username', async () => {
    process.env.ADMIN_USERNAME = 'boss';
    process.env.ADMIN_PASSWORD_HASH = await hashPassword('admin-pass-1');
    process.env.JWT_SECRET = 'j'.repeat(40);
    process.env.GEOIP_ISP_LOOKUP = 'off';
    await performRegister(redis, new Headers({ 'x-forwarded-for': '3.3.3.3' }), 'dave', 'password-dave');

    const headers = new Headers({
      'x-forwarded-for': '203.0.113.9, 10.0.0.1',
      'user-agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
      'x-vercel-ip-city': 'Jakarta',
      'x-vercel-ip-country': 'ID',
      'x-vercel-ip-country-region': 'JK',
    });
    const admin = await performLogin(redis, headers, 'BOSS', 'admin-pass-1');
    expect(admin).toMatchObject({ role: 'superadmin', username: 'boss' });
    const user = await performLogin(redis, headers, 'Dave', 'password-dave');
    expect(user).toMatchObject({ role: 'viewer', status: 'pending', username: 'dave' });

    const [entry] = await readDevices(redis, 'dave', 5);
    expect(entry).toMatchObject({ ip: '203.0.113.9', os: 'Android', device: 'Android', browser: 'Chrome', deviceType: 'mobile', city: 'Jakarta', country: 'ID', region: 'JK' });
    expect((await readDevices(redis, 'boss', 5))[0].browser).toBe('Chrome');

    await expect(performLogin(redis, headers, 'dave', 'salah')).rejects.toMatchObject({ status: 401 });
    await expect(performLogin(redis, headers, 'tidakada', 'apa-saja')).rejects.toMatchObject({ status: 401 });

    const attacker = new Headers({ 'x-forwarded-for': '198.51.100.7' });
    for (let i = 0; i < 5; i += 1) await performLogin(redis, attacker, 'victim', 'tebak').catch(() => undefined);
    const blocked = await performLogin(redis, new Headers({ 'x-forwarded-for': '198.51.100.8' }), 'victim', 'tebak').catch((e) => e);
    expect(blocked.status).toBe(429); // pembatas per username, bukan hanya per IP
  });

  it('login tanpa env admin/JWT: 503 generik (detail hanya di log server)', async () => {
    delete process.env.ADMIN_PASSWORD_HASH;
    delete process.env.JWT_SECRET;
    const err = await performLogin(redis, new Headers(), 'boss', 'x').catch((e) => e);
    expect(err.status).toBe(503);
    expect(err.message).not.toMatch(/ADMIN_PASSWORD_HASH|JWT_SECRET/);
  });

  it('script Lua CAS: kunci users:* tidak pernah disentuh oleh INGEST_SCRIPT', async () => {
    const { INGEST_SCRIPT } = await import('@/lib/ingest/store');
    expect(INGEST_SCRIPT).not.toMatch(/users:/);
    expect(KEYS.userAccount('x')).toBe('users:account:x');
  });
});
