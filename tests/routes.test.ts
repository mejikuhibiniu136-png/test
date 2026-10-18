// Route handler v5.1 dengan Redis SUNGGUHAN dan sesi di-mock: otorisasi per role, bentuk respons,
// audit, cron, ekspor. Dilewati bila Redis tidak tersedia.
import type IORedis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { KEYS } from '@/lib/keys';
import type { RedisLike } from '@/lib/redis';
import { connectTestRedis } from './helpers/redis';

const h = vi.hoisted(() => ({ redis: null as unknown, role: 'superadmin' as string }));
vi.mock('@/lib/redis', () => ({ getRedis: () => h.redis }));
vi.mock('@/lib/auth/session', async () => {
  const http = await import('@/lib/http');
  const session = () => ({ sub: 'root', role: h.role, status: 'active', sid: 's' });
  const staff = () => h.role === 'superadmin' || h.role === 'admin';
  return {
    requireSession: async () => ({ session: session() }),
    requireAdmin: async () => (staff() ? { session: session() } : { denied: http.forbidden() }),
    requireSuperadmin: async () => (h.role === 'superadmin' ? { session: session() } : { denied: http.forbiddenSuperadmin() }),
  };
});

const conn = await connectTestRedis();
const d = conn ? describe : describe.skip;
let raw: IORedis;

const body = (b: unknown) => JSON.stringify(b);
const req = (method: string, url: string, b?: unknown) => new Request(`http://t${url}`, { method, body: b === undefined ? undefined : body(b), headers: { 'x-forwarded-for': '5.5.5.5' } });
const audit = async () => (await raw.lrange(KEYS.auditLog, 0, -1)).map((r) => JSON.parse(r));
const KEY_A = 'a1'.repeat(32);
const KEY_B = 'b2'.repeat(32);

d('route v5.1 (Redis sungguhan)', () => {
  beforeAll(() => {
    h.redis = conn!.redis as RedisLike;
    raw = conn!.raw;
  });
  afterAll(async () => {
    await raw?.flushdb();
    raw?.disconnect();
    for (const k of ['ENCRYPTION_KEY', 'ENCRYPTION_KEY_PREVIOUS', 'CRON_SECRET']) delete process.env[k];
  });
  beforeEach(async () => {
    await raw.flushdb();
    h.role = 'superadmin';
    process.env.ENCRYPTION_KEY = KEY_A;
    delete process.env.ENCRYPTION_KEY_PREVIOUS;
    delete process.env.CRON_SECRET;
  });

  describe('/api/admin/apikey', () => {
    it('buat -> daftar -> cabut; nilai key hanya muncul sekali; audit tercatat; key tunggal lama dibersihkan', async () => {
      const apikey = await import('@/app/api/admin/apikey/route');
      await raw.hset(KEYS.settings, 'API_KEY', 'ciphertext-lama');
      const res = await apikey.POST(req('POST', '/api/admin/apikey', { label: '  skrip A ', expiresInDays: 30 }));
      expect(res.status).toBe(201);
      const created = await res.json();
      expect(created.apiKey).toMatch(/^dbde_[0-9a-f]{48}$/);
      expect(created.data).toMatchObject({ label: 'skrip A', expired: false });
      expect(await raw.hexists(KEYS.settings, 'API_KEY')).toBe(0);

      const list = await (await apikey.GET()).json();
      expect(list.data).toHaveLength(1);
      expect(JSON.stringify(list)).not.toContain(created.apiKey);

      const del = await apikey.DELETE(req('DELETE', `/api/admin/apikey?id=${created.data.id}`));
      expect(del.status).toBe(200);
      expect((await (await apikey.GET()).json()).data).toHaveLength(0);
      expect((await audit()).map((a) => a.action)).toEqual(['apikey.revoke', 'apikey.create']);
      expect(JSON.stringify(await audit())).not.toContain(created.apiKey);
    });

    it('validasi: label wajib, id tidak valid 400, id tak dikenal 404', async () => {
      const apikey = await import('@/app/api/admin/apikey/route');
      expect((await apikey.POST(req('POST', '/api/admin/apikey', { label: '   ' }))).status).toBe(400);
      expect((await apikey.POST(req('POST', '/api/admin/apikey', { label: 'x', expiresInDays: 0 }))).status).toBe(400);
      expect((await apikey.DELETE(req('DELETE', '/api/admin/apikey?id=../..'))).status).toBe(400);
      expect((await apikey.DELETE(req('DELETE', `/api/admin/apikey?id=${'0'.repeat(12)}`))).status).toBe(404);
    });

    it('hanya superadmin: admin dan viewer ditolak 403', async () => {
      const apikey = await import('@/app/api/admin/apikey/route');
      for (const role of ['admin', 'viewer']) {
        h.role = role;
        expect((await apikey.GET()).status).toBe(403);
        expect((await apikey.POST(req('POST', '/api/admin/apikey', { label: 'x' }))).status).toBe(403);
        expect((await apikey.DELETE(req('DELETE', `/api/admin/apikey?id=${'0'.repeat(12)}`))).status).toBe(403);
      }
      expect(await raw.hlen(KEYS.apiKeys)).toBe(0);
    });
  });

  describe('/api/admin/settings', () => {
    it('GET dan PUT mengembalikan bentuk yang sama; field baru tersimpan; rahasia tidak masuk audit', async () => {
      const settings = await import('@/app/api/admin/settings/route');
      const get = await (await settings.GET()).json();
      const put = await (await settings.PUT(req('PUT', '/api/admin/settings', { apiKeyRequired: true, logRetentionDays: 30, webhookSecret: 'super-rahasia-123' }))).json();
      expect(Object.keys(put).sort()).toEqual(Object.keys(get).sort());
      expect(put.encryptionReady).toBe(true);
      expect(put.data).toMatchObject({ apiKeyRequired: true, logRetentionDays: 30, webhookSecretSet: true });
      const [entry] = await audit();
      expect(entry).toMatchObject({ action: 'settings.update', actor: 'root', role: 'superadmin' });
      expect(entry.detail).toContain('apiKeyRequired=true');
      expect(entry.detail).toContain('webhookSecret=diganti');
      expect(JSON.stringify(await audit())).not.toContain('super-rahasia-123');
    });

    it('validasi retensi 0..3650; PUT tanpa perubahan tidak menulis audit; admin ditolak', async () => {
      const settings = await import('@/app/api/admin/settings/route');
      expect((await settings.PUT(req('PUT', '/api/admin/settings', { logRetentionDays: -1 }))).status).toBe(400);
      expect((await settings.PUT(req('PUT', '/api/admin/settings', { logRetentionDays: 4000 }))).status).toBe(400);
      expect((await settings.PUT(req('PUT', '/api/admin/settings', {}))).status).toBe(200);
      expect(await audit()).toHaveLength(0);
      h.role = 'admin';
      expect((await settings.PUT(req('PUT', '/api/admin/settings', { apiKeyRequired: true }))).status).toBe(403);
    });
  });

  describe('/api/admin/encryption/rotate', () => {
    it('menolak bila kunci lama belum diatur; berhasil mengenkripsi ulang bila sudah', async () => {
      const settings = await import('@/app/api/admin/settings/route');
      const rotate = await import('@/app/api/admin/encryption/rotate/route');
      await settings.PUT(req('PUT', '/api/admin/settings', { webhookSecret: 'rahasia-webhook' }));
      expect((await rotate.POST(req('POST', '/api/admin/encryption/rotate'))).status).toBe(400);

      process.env.ENCRYPTION_KEY = KEY_B;
      process.env.ENCRYPTION_KEY_PREVIOUS = KEY_A;
      const status = await (await settings.GET()).json();
      expect(status.encryption).toEqual({ previousKey: 'valid', stale: 1, undecryptable: 0 });
      const res = await (await rotate.POST(req('POST', '/api/admin/encryption/rotate'))).json();
      expect(res.data).toEqual({ rotated: 1, alreadyCurrent: 0, failed: 0 });
      expect((await (await settings.GET()).json()).encryption.stale).toBe(0);
      expect((await audit())[0]).toMatchObject({ action: 'encryption.rotate' });
    });

    it('tanpa ENCRYPTION_KEY: 400; admin: 403', async () => {
      const rotate = await import('@/app/api/admin/encryption/rotate/route');
      delete process.env.ENCRYPTION_KEY;
      expect((await rotate.POST(req('POST', '/api/admin/encryption/rotate'))).status).toBe(400);
      h.role = 'admin';
      expect((await rotate.POST(req('POST', '/api/admin/encryption/rotate'))).status).toBe(403);
    });
  });

  describe('retensi', () => {
    const old = JSON.stringify({ id: 'o', receivedAt: new Date(Date.now() - 90 * 86_400_000).toISOString(), game: 'g', gameName: 'G', eventType: 'x', payload: {}, format: 'json', bytes: 1, processingTimeMs: 1 });

    it('POST /api/admin/retention: 400 saat nonaktif; menghapus dan mengaudit saat aktif', async () => {
      const retention = await import('@/app/api/admin/retention/route');
      expect((await retention.POST(req('POST', '/api/admin/retention'))).status).toBe(400);
      await raw.hset(KEYS.settings, 'LOG_RETENTION_DAYS', '30');
      await raw.rpush(KEYS.streamLogs, old, old);
      const res = await (await retention.POST(req('POST', '/api/admin/retention'))).json();
      expect(res.data.removed).toBe(2);
      expect(await raw.llen(KEYS.streamLogs)).toBe(0);
      expect((await audit())[0]).toMatchObject({ action: 'retention.purge', actor: 'root' });
    });

    it('cron: 503 tanpa CRON_SECRET, 401 salah, 200 benar; skip saat nonaktif; audit oleh "cron" hanya bila ada yang dihapus', async () => {
      const cron = await import('@/app/api/cron/retention/route');
      const call = (secret?: string) => cron.GET(new Request('http://t/api/cron/retention', { headers: secret ? { authorization: `Bearer ${secret}` } : {} }));
      expect((await call('apa-saja')).status).toBe(503);
      process.env.CRON_SECRET = 'cron-rahasia-1234';
      expect((await call()).status).toBe(401);
      expect((await call('salah')).status).toBe(401);
      expect((await (await call('cron-rahasia-1234')).json()).skipped).toBe(true);

      await raw.hset(KEYS.settings, 'LOG_RETENTION_DAYS', '30');
      expect((await call('cron-rahasia-1234')).status).toBe(200);
      expect(await audit()).toHaveLength(0); // tidak ada yang dihapus: tidak ada derau audit
      await raw.rpush(KEYS.streamLogs, old);
      expect((await (await call('cron-rahasia-1234')).json()).data.removed).toBe(1);
      expect((await audit())[0]).toMatchObject({ action: 'retention.purge', actor: 'cron', role: 'system' });
    });

    it('proxy membuka /api/cron/* tanpa sesi (dijaga CRON_SECRET di route)', async () => {
      const { proxy } = await import('@/proxy');
      const { NextRequest } = await import('next/server');
      const res = await proxy(new NextRequest('http://t/api/cron/retention'));
      expect(res.status).toBe(200);
      const closed = await proxy(new NextRequest('http://t/api/admin/audit'));
      expect(closed.status).toBe(401);
    });
  });

  describe('/api/logs/export', () => {
    it('CSV dan JSON penuh dengan header unduhan; slug tidak valid 400; viewer boleh (setara baca log)', async () => {
      const exp = await import('@/app/api/logs/export/route');
      const mk = (i: number) => JSON.stringify({ id: `l${i}`, receivedAt: new Date(1_700_000_000_000 + i).toISOString(), game: 'g', gameName: 'G', eventType: 'x', payload: { username: `u${i}` }, format: 'json', bytes: 1, processingTimeMs: 1 });
      await raw.rpush(KEYS.streamLogs, ...Array.from({ length: 700 }, (_, i) => mk(i))); // > batas 500 di layar
      h.role = 'viewer';
      const csv = await exp.GET(req('GET', '/api/logs/export?game=all&format=csv'));
      expect(csv.headers.get('content-disposition')).toMatch(/^attachment; filename="logs-all-.+\.csv"$/);
      expect(csv.headers.get('content-type')).toContain('text/csv');
      expect((await csv.text()).split('\r\n')).toHaveLength(701); // header + 700 baris
      const json = await exp.GET(req('GET', '/api/logs/export?game=all&format=json'));
      expect(JSON.parse(await json.text())).toHaveLength(700);
      expect((await exp.GET(req('GET', '/api/logs/export?game=../x'))).status).toBe(400);
    });
  });

  describe('/api/admin/audit', () => {
    it('superadmin membaca terbaru-dulu dengan limit; admin 403', async () => {
      const route = await import('@/app/api/admin/audit/route');
      const { recordAudit } = await import('@/lib/audit');
      for (let i = 0; i < 5; i += 1) await recordAudit(h.redis as RedisLike, { actor: `u${i}`, role: 'admin', action: 'logs.clear' });
      const res = await (await route.GET(req('GET', '/api/admin/audit?limit=3'))).json();
      expect(res.data.map((e: { actor: string }) => e.actor)).toEqual(['u4', 'u3', 'u2']);
      h.role = 'admin';
      expect((await route.GET(req('GET', '/api/admin/audit'))).status).toBe(403);
    });
  });

  describe('audit di route yang sudah ada', () => {
    it('saklar receiver, hapus log, hapus game, hapus akun, ubah pengguna: semua tercatat dengan pelaku dan IP', async () => {
      const receiver = await import('@/app/api/system/receiver/route');
      const logs = await import('@/app/api/logs/route');
      const games = await import('@/app/api/games/[slug]/route');
      const accounts = await import('@/app/api/accounts/route');
      const users = await import('@/app/api/admin/users/[username]/route');
      const { createUser } = await import('@/lib/users');
      const { createGame } = await import('@/lib/games');
      const redis = h.redis as RedisLike;

      expect((await receiver.POST(req('POST', '/api/system/receiver', { enabled: false }))).status).toBe(200);
      await createGame(redis, 'Audit Game', 'root');
      expect((await logs.DELETE(req('DELETE', '/api/logs?game=audit-game'))).status).toBe(200);
      expect((await games.DELETE(req('DELETE', '/api/games/audit-game'), { params: Promise.resolve({ slug: 'audit-game' }) })).status).toBe(200);
      await raw.hset(KEYS.trackerAccounts, 'alice', JSON.stringify({ username: 'alice', rev: 1 }));
      expect((await accounts.DELETE(req('DELETE', '/api/accounts?username=alice'))).status).toBe(200);
      await createUser(redis, 'bob', 'password-bob-123', []);
      const upd = await users.PATCH(req('PATCH', '/api/admin/users/bob', { status: 'active', role: 'admin' }), { params: Promise.resolve({ username: 'bob' }) });
      expect(upd.status).toBe(200);

      const entries = (await audit()).reverse();
      expect(entries.map((e) => e.action)).toEqual(['receiver.toggle', 'logs.clear', 'game.delete', 'account.delete', 'user.update']);
      expect(entries[0].detail).toBe('receiver dimatikan');
      expect(entries[1]).toMatchObject({ target: 'audit-game', actor: 'root', role: 'superadmin', ip: '5.5.5.5' });
      expect(entries[4]).toMatchObject({ target: 'bob', detail: 'status=active, role=admin' });
    });

    it('aksi yang ditolak (403) tidak menulis audit', async () => {
      const logs = await import('@/app/api/logs/route');
      h.role = 'viewer';
      expect((await logs.DELETE(req('DELETE', '/api/logs?game=all'))).status).toBe(403);
      expect(await audit()).toHaveLength(0);
    });
  });

  describe('/api/system', () => {
    it('menyertakan statistik keamanan 24 jam', async () => {
      Object.assign(process.env, {
        UPSTASH_REDIS_REST_URL: 'http://127.0.0.1:1', UPSTASH_REDIS_REST_TOKEN: 't', SUPERADMIN_USERNAME: 'root',
        SUPERADMIN_PASSWORD_HASH: '$argon2id$v=19$m=19456,t=2,p=1$abc$def', JWT_SECRET: 'j'.repeat(40),
      });
      const { recordSecurityEvent } = await import('@/lib/securityStats');
      await recordSecurityEvent(h.redis as RedisLike, 'hmac_fail');
      await recordSecurityEvent(h.redis as RedisLike, 'rate_limited');
      const system = await import('@/app/api/system/route');
      const res = await (await system.GET()).json();
      expect(res.redis.ok).toBe(true);
      expect(res.security).toEqual({ windowHours: 24, hmacFail: 1, authFail: 0, rateLimited: 1 });
      for (const k of ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'SUPERADMIN_USERNAME', 'SUPERADMIN_PASSWORD_HASH', 'JWT_SECRET']) delete process.env[k];
    });
  });
});
