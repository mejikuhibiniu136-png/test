// Fitur v5.1 dengan Redis SUNGGUHAN: API Key banyak + enforcement, rate limit per key/dinamis,
// statistik keamanan, audit, rotasi ENCRYPTION_KEY, retensi log. Dilewati bila Redis tidak ada.
import { createHmac } from 'node:crypto';
import type IORedis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { __resetApiKeyUsedThrottle, MAX_API_KEYS, authenticateApiKey, createApiKey, hashApiKey, listApiKeys, revokeApiKey } from '@/lib/apikeys';
import { AUDIT_MAX, readAudit, recordAudit } from '@/lib/audit';
import { handleIngest } from '@/lib/ingest/handler';
import { __resetReceiverCache } from '@/lib/ingest/store';
import { __clearResolveCache } from '@/lib/games';
import { KEYS } from '@/lib/keys';
import type { RedisLike } from '@/lib/redis';
import { purgeOldLogs } from '@/lib/retention';
import { readSecurityStats, recordSecurityEvent } from '@/lib/securityStats';
import { __resetRuntimeSettingsCache, inspectSecrets, readSecretSetting, readSettings, reencryptSecrets, writeSecretSetting, writeSetting } from '@/lib/settings';
import { connectTestRedis } from './helpers/redis';

const conn = await connectTestRedis();
const d = conn ? describe : describe.skip;

let redis: RedisLike;
let raw: IORedis;

const KEY_A = 'a1'.repeat(32);
const KEY_B = 'b2'.repeat(32);
const KEY_C = 'c3'.repeat(32);
const DAY = 86_400_000;

let n = 0;
const send = (headers: Record<string, string> = {}, body = '{"game_name":"Feat Game"}', url = 'http://t/api/receiver/universal') =>
  handleIngest(new Request(url, { method: 'POST', body, headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.9.${(n += 1) % 250}.1`, ...headers } }), {}, { redis });

d('fitur v5.1 (Redis sungguhan)', () => {
  beforeAll(() => {
    redis = conn!.redis;
    raw = conn!.raw;
  });
  afterAll(async () => {
    await raw?.flushdb();
    raw?.disconnect();
    for (const k of ['ENCRYPTION_KEY', 'ENCRYPTION_KEY_PREVIOUS', 'WEBHOOK_INGEST_TOKEN']) delete process.env[k];
  });
  beforeEach(async () => {
    await raw.flushdb();
    __resetReceiverCache();
    __resetRuntimeSettingsCache();
    __resetApiKeyUsedThrottle();
    __clearResolveCache();
    delete process.env.WEBHOOK_INGEST_TOKEN;
    delete process.env.ENCRYPTION_KEY_PREVIOUS;
    process.env.ENCRYPTION_KEY = KEY_A;
  });

  // ---------- API Key ----------

  describe('API Key', () => {
    it('hanya hash yang tersimpan; nilai key tidak pernah ada di Redis maupun di daftar', async () => {
      const { key, view } = await createApiKey(redis, { label: 'skrip A', by: 'root' });
      expect(key).toMatch(/^dbde_[0-9a-f]{48}$/);
      const dump = JSON.stringify(await raw.hgetall(KEYS.apiKeys));
      expect(dump).not.toContain(key);
      expect(await raw.hexists(KEYS.apiKeys, hashApiKey(key))).toBe(1);
      expect(JSON.stringify(await listApiKeys(redis))).not.toContain(key);
      expect(view).toMatchObject({ label: 'skrip A', createdBy: 'root', expiresAt: null, lastUsedAt: null, expired: false });
      expect(view.hint).toContain('••••');
    });

    it('autentikasi: key benar lolos; salah, format asing, dan kosong ditolak', async () => {
      const { key, view } = await createApiKey(redis, { label: 'k', by: 'root' });
      expect(await authenticateApiKey(redis, key)).toEqual({ id: view.id, label: 'k' });
      expect(await authenticateApiKey(redis, `dbde_${'0'.repeat(48)}`)).toBeNull();
      expect(await authenticateApiKey(redis, 'token-bebas')).toBeNull();
      expect(await authenticateApiKey(redis, '')).toBeNull();
    });

    it('kedaluwarsa: ditolak setelah batas, daftar menandai expired', async () => {
      const t0 = Date.now();
      const { key } = await createApiKey(redis, { label: 'sementara', expiresInDays: 1, by: 'root' }, t0);
      expect(await authenticateApiKey(redis, key, t0 + DAY / 2)).not.toBeNull();
      expect(await authenticateApiKey(redis, key, t0 + 2 * DAY)).toBeNull();
      const [row] = await listApiKeys(redis, t0 + 2 * DAY);
      expect(row.expired).toBe(true);
    });

    it('cabut satu key tidak mengganggu key lain; id tak dikenal = false', async () => {
      const a = await createApiKey(redis, { label: 'A', by: 'root' });
      const b = await createApiKey(redis, { label: 'B', by: 'root' });
      expect(await revokeApiKey(redis, a.view.id)).toBe(true);
      expect(await authenticateApiKey(redis, a.key)).toBeNull();
      expect(await authenticateApiKey(redis, b.key)).not.toBeNull();
      expect(await revokeApiKey(redis, a.view.id)).toBe(false);
      expect((await listApiKeys(redis)).map((k) => k.label)).toEqual(['B']);
    });

    it('"terakhir dipakai" tercatat, dan mencabut key menghapus catatannya', async () => {
      const { key, view } = await createApiKey(redis, { label: 'pakai', by: 'root' });
      const t = Date.now();
      await authenticateApiKey(redis, key, t);
      expect((await listApiKeys(redis))[0].lastUsedAt).toBe(new Date(t).toISOString());
      await revokeApiKey(redis, view.id);
      expect(await raw.hexists(KEYS.apiKeysUsed, view.id)).toBe(0);
    });

    it(`batas ${MAX_API_KEYS} key`, async () => {
      for (let i = 0; i < MAX_API_KEYS; i += 1) await createApiKey(redis, { label: `k${i}`, by: 'root' });
      await expect(createApiKey(redis, { label: 'lebih', by: 'root' })).rejects.toMatchObject({ status: 400 });
    });
  });

  // ---------- Enforcement di receiver ----------

  describe('receiver: API Key', () => {
    it('bawaan terbuka; "Wajibkan API Key" menolak tanpa key, menerima key valid di ketiga tempat', async () => {
      const { key } = await createApiKey(redis, { label: 'k', by: 'root' });
      expect((await send()).status).toBe(200); // saklar mati: tetap terbuka, kompatibel skrip lama
      await writeSetting(redis, 'API_KEY_REQUIRED', true);
      expect((await send()).status).toBe(401);
      expect((await send({ 'x-api-key': 'dbde_salah' })).status).toBe(401);
      expect((await send({ 'x-api-key': key })).status).toBe(200);
      expect((await send({ authorization: `Bearer ${key}` })).status).toBe(200);
      expect((await send({}, undefined, `http://t/api/receiver/universal?key=${key}`)).status).toBe(200);
    });

    it('key dicabut atau kedaluwarsa langsung ditolak saat wajib', async () => {
      const a = await createApiKey(redis, { label: 'dicabut', by: 'root' });
      const b = await createApiKey(redis, { label: 'lama', expiresInDays: 1, by: 'root' }, Date.now() - 3 * DAY);
      await writeSetting(redis, 'API_KEY_REQUIRED', true);
      expect((await send({ 'x-api-key': a.key })).status).toBe(200);
      await revokeApiKey(redis, a.view.id);
      expect((await send({ 'x-api-key': a.key })).status).toBe(401);
      expect((await send({ 'x-api-key': b.key })).status).toBe(401);
    });

    it('WEBHOOK_INGEST_TOKEN (env) tetap berlaku berdampingan dengan API Key dashboard', async () => {
      const { key } = await createApiKey(redis, { label: 'k', by: 'root' });
      process.env.WEBHOOK_INGEST_TOKEN = 'token-env-rahasia-1';
      expect((await send()).status).toBe(401); // env token mewajibkan kredensial walau saklar mati
      expect((await send({ 'x-api-key': 'token-env-rahasia-1' })).status).toBe(200);
      expect((await send({ 'x-api-key': key })).status).toBe(200);
    });

    it('pengaturan berlaku segera di instance yang sama (cache dibuang saat menulis)', async () => {
      expect((await send()).status).toBe(200);
      await writeSetting(redis, 'API_KEY_REQUIRED', true);
      expect((await send()).status).toBe(401);
      await writeSetting(redis, 'API_KEY_REQUIRED', false);
      expect((await send()).status).toBe(200);
    });
  });

  // ---------- Rate limit ----------

  describe('rate limit', () => {
    it('memakai nilai dari dashboard (bukan angka tetap 600), per IP', async () => {
      await writeSetting(redis, 'RATE_LIMIT_PER_MIN', 10);
      const codes: number[] = [];
      for (let i = 0; i < 12; i += 1) codes.push((await send({ 'x-forwarded-for': '9.9.9.9' })).status);
      expect(codes.slice(0, 10).every((c) => c === 200)).toBe(true);
      expect(codes.slice(10)).toEqual([429, 429]);
      expect((await send({ 'x-forwarded-for': '9.9.9.10' })).status).toBe(200); // IP lain tidak terdampak
    });

    it('per API Key: key yang habis tidak menghalangi key lain di IP yang sama, dan IP tidak dihitung', async () => {
      const a = await createApiKey(redis, { label: 'A', by: 'root' });
      const b = await createApiKey(redis, { label: 'B', by: 'root' });
      await writeSetting(redis, 'RATE_LIMIT_PER_MIN', 10);
      const ip = { 'x-forwarded-for': '8.8.8.8' };
      for (let i = 0; i < 10; i += 1) expect((await send({ ...ip, 'x-api-key': a.key })).status).toBe(200);
      const over = await send({ ...ip, 'x-api-key': a.key });
      expect(over.status).toBe(429);
      expect(over.headers.get('retry-after')).toBeTruthy();
      expect((await send({ ...ip, 'x-api-key': b.key })).status).toBe(200); // key B, IP sama
      expect((await send(ip)).status).toBe(200); // anonim di IP yang sama memakai bucket IP
      expect(await raw.exists(KEYS.rateLimit('ingest-key', a.view.id))).toBe(1);
    });
  });

  // ---------- Statistik keamanan ----------

  describe('statistik keamanan', () => {
    it('mencatat auth gagal, rate limit, dan HMAC gagal; HMAC benar tidak dihitung', async () => {
      await writeSetting(redis, 'API_KEY_REQUIRED', true);
      await send();
      await send({ 'x-api-key': 'dbde_salah' });
      await writeSetting(redis, 'API_KEY_REQUIRED', false);

      await writeSecretSetting(redis, 'WEBHOOK_SECRET', 'secret-hmac-123');
      const body = '{"game_name":"Hmac Game"}';
      const good = createHmac('sha256', 'secret-hmac-123').update(body).digest('hex');
      expect((await send({ 'x-webhook-signature': good }, body)).status).toBe(200);
      expect((await send({ 'x-webhook-signature': 'a'.repeat(64) }, body)).status).toBe(401);
      expect((await send({}, body)).status).toBe(401);
      await raw.hdel(KEYS.settings, 'WEBHOOK_SECRET');

      await writeSetting(redis, 'RATE_LIMIT_PER_MIN', 10);
      for (let i = 0; i < 12; i += 1) await send({ 'x-forwarded-for': '7.7.7.1' });

      expect(await readSecurityStats(redis)).toEqual({ windowHours: 24, authFail: 2, hmacFail: 2, rateLimited: 2 });
    });

    it('jendela 24 jam: kejadian lama tidak ikut, key kedaluwarsa sendiri', async () => {
      const now = Date.UTC(2026, 9, 16, 12, 30);
      await recordSecurityEvent(redis, 'auth_fail', now);
      await recordSecurityEvent(redis, 'auth_fail', now - 23 * 3_600_000); // masih dalam jendela (13:xx kemarin)
      await recordSecurityEvent(redis, 'auth_fail', now - 25 * 3_600_000); // di luar jendela
      expect((await readSecurityStats(redis, now)).authFail).toBe(2);
      const ttl = await raw.ttl(KEYS.securityStats('2026-10-16'));
      expect(ttl).toBeGreaterThan(0);
    });

    it('Redis rusak: mencatat tidak melempar', async () => {
      const broken = { hincrby: async () => { throw new Error('down'); } } as unknown as RedisLike;
      await expect(recordSecurityEvent(broken, 'auth_fail')).resolves.toBeUndefined();
    });
  });

  // ---------- Audit ----------

  describe('audit', () => {
    it('terbaru di depan, field lengkap, karakter kontrol dibersihkan, panjang dibatasi', async () => {
      await recordAudit(redis, { actor: 'root', role: 'superadmin', action: 'apikey.create', target: 'A', ip: '1.1.1.1' }, 1000);
      await recordAudit(redis, { actor: 'root', role: 'superadmin', action: 'settings.update', detail: `x\ny\u0000${'z'.repeat(500)}` }, 2000);
      const [latest, older] = await readAudit(redis, 10);
      expect(latest.action).toBe('settings.update');
      expect(latest.detail).not.toMatch(/[\u0000-\u001f]/);
      expect(latest.detail!.length).toBeLessThanOrEqual(300);
      expect(older).toMatchObject({ actor: 'root', role: 'superadmin', action: 'apikey.create', target: 'A', ip: '1.1.1.1', at: new Date(1000).toISOString() });
    });

    it(`dipangkas ke ${AUDIT_MAX} entri terbaru`, async () => {
      for (let i = 0; i < AUDIT_MAX + 5; i += 1) await recordAudit(redis, { actor: `u${i}`, role: 'admin', action: 'logs.clear' });
      expect(await raw.llen(KEYS.auditLog)).toBe(AUDIT_MAX);
      expect((await readAudit(redis, 1))[0].actor).toBe(`u${AUDIT_MAX + 4}`);
    });

    it('Redis rusak: mencatat tidak melempar (aksi asalnya tidak boleh gagal)', async () => {
      const broken = { lpush: async () => { throw new Error('down'); } } as unknown as RedisLike;
      await expect(recordAudit(broken, { actor: 'a', role: 'admin', action: 'logs.clear' })).resolves.toBeUndefined();
    });
  });

  // ---------- Rotasi ENCRYPTION_KEY ----------

  describe('rotasi ENCRYPTION_KEY', () => {
    it('alur penuh: kunci diganti -> secret tetap terbaca -> enkripsi ulang -> kunci lama boleh dibuang', async () => {
      await writeSecretSetting(redis, 'WEBHOOK_SECRET', 'rahasia-lama');
      const before = (await raw.hget(KEYS.settings, 'WEBHOOK_SECRET'))!;

      process.env.ENCRYPTION_KEY = KEY_B; // kunci baru, kunci lama diparkir
      process.env.ENCRYPTION_KEY_PREVIOUS = KEY_A;
      expect(await readSecretSetting(redis, 'WEBHOOK_SECRET')).toBe('rahasia-lama'); // HMAC tidak putus
      expect(await inspectSecrets(redis)).toEqual({ previousKey: 'valid', stale: 1, undecryptable: 0 });

      expect(await reencryptSecrets(redis)).toEqual({ rotated: 1, alreadyCurrent: 0, failed: 0 });
      expect((await raw.hget(KEYS.settings, 'WEBHOOK_SECRET'))).not.toBe(before);
      expect(await inspectSecrets(redis)).toMatchObject({ stale: 0, undecryptable: 0 });

      delete process.env.ENCRYPTION_KEY_PREVIOUS; // kunci lama dibuang
      expect(await readSecretSetting(redis, 'WEBHOOK_SECRET')).toBe('rahasia-lama');
      expect(await reencryptSecrets(redis)).toEqual({ rotated: 0, alreadyCurrent: 1, failed: 0 }); // idempoten
    });

    it('kunci hilang/salah tanpa kunci lama: terdeteksi undecryptable, tidak ada yang ditimpa', async () => {
      await writeSecretSetting(redis, 'WEBHOOK_SECRET', 'rahasia');
      const before = await raw.hget(KEYS.settings, 'WEBHOOK_SECRET');
      process.env.ENCRYPTION_KEY = KEY_C;
      expect(await inspectSecrets(redis)).toMatchObject({ previousKey: 'unset', stale: 0, undecryptable: 1 });
      expect(await readSecretSetting(redis, 'WEBHOOK_SECRET')).toBeNull();
      expect(await reencryptSecrets(redis)).toEqual({ rotated: 0, alreadyCurrent: 0, failed: 1 });
      expect(await raw.hget(KEYS.settings, 'WEBHOOK_SECRET')).toBe(before);
    });

    it('ENCRYPTION_KEY_PREVIOUS tidak valid dilaporkan "invalid" dan tidak dipakai', async () => {
      process.env.ENCRYPTION_KEY_PREVIOUS = 'bukan-hex';
      expect((await inspectSecrets(redis)).previousKey).toBe('invalid');
    });

    it('secret yang diganti di tengah rotasi tidak ditimpa (compare-and-set)', async () => {
      await writeSecretSetting(redis, 'WEBHOOK_SECRET', 'lama');
      process.env.ENCRYPTION_KEY = KEY_B;
      process.env.ENCRYPTION_KEY_PREVIOUS = KEY_A;
      // Superadmin mengganti secret tepat setelah rotasi membaca nilai lamanya.
      const racing: RedisLike = { ...redis, hget: async (k, f) => { const v = await redis.hget(k, f); await writeSecretSetting(redis, 'WEBHOOK_SECRET', 'baru-saja-diganti'); return v; } };
      const res = await reencryptSecrets(racing);
      expect(res.rotated).toBe(0);
      expect(res.failed).toBe(1);
      expect(await readSecretSetting(redis, 'WEBHOOK_SECRET')).toBe('baru-saja-diganti');
    });
  });

  // ---------- Retensi ----------

  describe('retensi log', () => {
    const entry = (id: string, at: number) => JSON.stringify({ id, receivedAt: new Date(at).toISOString(), game: 'feat-game', gameName: 'Feat Game', eventType: 'x', payload: {}, format: 'json', bytes: 2, processingTimeMs: 1 });

    it('memangkas log kedaluwarsa di stream; log baru dan key users:* tidak tersentuh', async () => {
      await send(); // membuat tabel feat-game + 1 log baru di depan
      const now = Date.now();
      await raw.rpush(KEYS.streamLogs, entry('s-old1', now - 10 * DAY), entry('s-old2', now - 40 * DAY));
      await raw.set('users:account:keep', 'x');
      const res = await purgeOldLogs(redis, 7, now);
      expect(res.removed).toBe(2);
      expect(await raw.llen(KEYS.streamLogs)).toBe(1);
      expect(await raw.get('users:account:keep')).toBe('x');
    });

    it('pemangkasan berhenti di entri pertama (dari ekor) yang masih dalam batas', async () => {
      await send();
      const now = Date.now();
      // Ekor = terlama. Entri 5 hari (dalam batas 7 hari) berada di ekor, jadi yang 9 hari di depannya tetap.
      await raw.rpush(KEYS.gameLogs('feat-game'), entry('g-9d', now - 9 * DAY), entry('g-5d', now - 5 * DAY));
      expect((await purgeOldLogs(redis, 7, now)).removed).toBe(0);
      expect(await raw.llen(KEYS.gameLogs('feat-game'))).toBe(3);
    });

    it('urutan normal (terbaru di depan): semua yang kedaluwarsa di ekor dihapus, hitungan akurat', async () => {
      await send();
      const now = Date.now();
      await raw.rpush(KEYS.gameLogs('feat-game'), entry('a', now - 2 * DAY), entry('b', now - 8 * DAY), entry('c', now - 30 * DAY));
      const seqBefore = Number(await raw.get(KEYS.streamSeq));
      const res = await purgeOldLogs(redis, 7, now);
      expect(res.removed).toBe(2);
      const ids = (await raw.lrange(KEYS.gameLogs('feat-game'), 0, -1)).map((r) => JSON.parse(r).id);
      expect(ids).toHaveLength(2);
      expect(ids).toContain('a');
      expect(ids).not.toContain('b');
      expect(Number(await raw.get(KEYS.streamSeq))).toBeGreaterThan(seqBefore); // SSE memuat ulang
    });

    it('0 hari = nonaktif (tidak menghapus apa pun); tidak ada yang kedaluwarsa = 0', async () => {
      await send();
      await raw.rpush(KEYS.streamLogs, entry('old', Date.now() - 400 * DAY));
      expect(await purgeOldLogs(redis, 0)).toEqual({ removed: 0, keys: 0 });
      expect(await raw.llen(KEYS.streamLogs)).toBe(2);
      expect((await purgeOldLogs(redis, 3650)).removed).toBe(0);
    });

    it('setelan tersimpan dan dibaca kembali (batas 0..3650)', async () => {
      await writeSetting(redis, 'LOG_RETENTION_DAYS', 30);
      expect((await readSettings(redis)).logRetentionDays).toBe(30);
      await raw.hset(KEYS.settings, 'LOG_RETENTION_DAYS', '999999');
      expect((await readSettings(redis)).logRetentionDays).toBe(3650);
      await raw.hset(KEYS.settings, 'LOG_RETENTION_DAYS', 'abc');
      expect((await readSettings(redis)).logRetentionDays).toBe(0);
    });
  });
});
