// Registri sesi, pencabutan paksa, RBAC route /api/sessions, dan hook login (IP baru -> alert).
import type IORedis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '@/lib/auth/password';
import { performLogin } from '@/lib/auth/login';
import { verifySession } from '@/lib/auth/jwt';
import { __resetNotifyCache, writeChannel } from '@/lib/notify/config';
import type { RedisLike } from '@/lib/redis';
import { __resetSessionCaches, isSessionRevoked, listAllSessions, listSessionsOf, recordFromDevice, registerSession, revokeAllForUser, revokeSession, touchSession } from '@/lib/sessions';
import { KEYS } from '@/lib/keys';
import type { DeviceEntry } from '@/types';
import { connectTestRedis } from './helpers/redis';

const h = vi.hoisted(() => ({ redis: null as unknown, role: 'superadmin' as string, sub: 'root', sid: 'a0000000-0000-4000-8000-000000000000' }));
vi.mock('@/lib/redis', () => ({ getRedis: () => h.redis }));
vi.mock('@/lib/rbac/guard', async () => {
  const { can } = await import('@/lib/rbac/permissions');
  const { json } = await import('@/lib/http');
  return {
    requirePermission: async (p: Parameters<typeof can>[1]) =>
      can(h.role as never, p) ? { session: { sub: h.sub, role: h.role, status: 'active', sid: h.sid } } : { denied: json({ success: false, message: 'Anda tidak memiliki izin untuk aksi ini' }, 403) },
  };
});

const conn = await connectTestRedis();
const d = conn ? describe : describe.skip;
let redis: RedisLike;
let raw: IORedis;

const dev = (sid: string, ip = '1.1.1.1'): DeviceEntry => ({ sid, at: new Date().toISOString(), ip, device: 'Windows', deviceType: 'desktop', os: 'Windows', browser: 'Chrome', city: 'Bekasi', region: 'JB', country: 'ID', isp: null, userAgent: 'UA' });
const SID1 = '11111111-1111-4111-8111-111111111111';
const SID2 = '22222222-2222-4222-8222-222222222222';
const SID3 = '33333333-3333-4333-8333-333333333333';
const del = (q: string) => new Request(`http://t/api/sessions?${q}`, { method: 'DELETE', headers: { 'x-forwarded-for': '9.9.9.9' } });

d('sesi & perangkat (Redis sungguhan)', () => {
  beforeAll(() => { redis = conn!.redis; raw = conn!.raw; h.redis = redis; });
  afterAll(async () => { await raw?.flushdb(); raw?.disconnect(); for (const k of ['ENCRYPTION_KEY', 'JWT_SECRET', 'SUPERADMIN_USERNAME', 'SUPERADMIN_PASSWORD_HASH']) delete process.env[k]; vi.unstubAllGlobals(); });
  beforeEach(async () => { await raw.flushdb(); __resetSessionCaches(); __resetNotifyCache(); h.role = 'superadmin'; h.sub = 'root'; });

  it('daftar -> cabut: sesi hilang dari registri dan masuk deny-list dengan TTL', async () => {
    await registerSession(redis, recordFromDevice('Alice', 'viewer', dev(SID1)));
    await registerSession(redis, recordFromDevice('Alice', 'viewer', dev(SID2, '2.2.2.2')));
    expect((await listSessionsOf(redis, 'alice')).map((s) => s.sid).sort()).toEqual([SID1, SID2]);
    expect(await isSessionRevoked(redis, SID1)).toBe(false);

    expect(await revokeSession(redis, 'ALICE', SID1)).toBe(true);
    expect(await isSessionRevoked(redis, SID1)).toBe(true);
    expect((await listSessionsOf(redis, 'alice')).map((s) => s.sid)).toEqual([SID2]);
    const ttl = await raw.ttl(KEYS.sessionRevoked(SID1));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(8 * 3600);
  });

  it('cache negatif 3 dtk: pencabutan oleh instance lain terlihat setelah jendela cache', async () => {
    expect(await isSessionRevoked(redis, SID3, 1000)).toBe(false);
    await raw.set(KEYS.sessionRevoked(SID3), '1', 'EX', 60); // dicabut oleh instance lain
    expect(await isSessionRevoked(redis, SID3, 2000)).toBe(false); // masih cache
    expect(await isSessionRevoked(redis, SID3, 4500)).toBe(true);
    expect(await isSessionRevoked(redis, SID3, 4600)).toBe(true); // positif permanen
  });

  it('sid tidak valid / token lama tanpa sid tidak pernah dianggap dicabut', async () => {
    expect(await isSessionRevoked(redis, '')).toBe(false);
    expect(await isSessionRevoked(redis, 'bukan-uuid')).toBe(false);
  });

  it('revokeAllForUser menyisakan sesi yang sedang dipakai', async () => {
    for (const s of [SID1, SID2, SID3]) await registerSession(redis, recordFromDevice('bob', 'admin', dev(s)));
    expect(await revokeAllForUser(redis, 'bob', SID2)).toBe(2);
    expect((await listSessionsOf(redis, 'bob')).map((s) => s.sid)).toEqual([SID2]);
  });

  it('sesi kedaluwarsa dibersihkan saat dibaca', async () => {
    await registerSession(redis, recordFromDevice('eve', 'viewer', dev(SID1), Date.now() - 9 * 3600_000));
    expect(await listSessionsOf(redis, 'eve')).toEqual([]);
    expect(await raw.hlen(KEYS.sessionsOf('eve'))).toBe(0);
  });

  it('touchSession diperbarui paling sering sekali per menit dan tidak membuat sesi lama dari nol', async () => {
    await registerSession(redis, recordFromDevice('carl', 'viewer', dev(SID1), 0 + Date.now() - 1000));
    const before = (await listSessionsOf(redis, 'carl'))[0].lastSeenAt;
    const now = Date.now() + 120_000;
    await touchSession(redis, 'carl', SID1, now);
    const after = (await listSessionsOf(redis, 'carl'))[0].lastSeenAt;
    expect(after > before).toBe(true);
    await touchSession(redis, 'carl', SID1, now + 1000); // dalam jendela: tidak menulis lagi
    expect((await listSessionsOf(redis, 'carl'))[0].lastSeenAt).toBe(after);
    await touchSession(redis, 'ghost', SID2, now); // tidak ada catatan: tidak dibuat
    expect(await raw.hlen(KEYS.sessionsOf('ghost'))).toBe(0);
  });

  describe('route /api/sessions (RBAC)', () => {
    it('viewer: hanya sesi sendiri; scope=all ditolak; tidak bisa mencabut sesi orang lain', async () => {
      const route = await import('@/app/api/sessions/route');
      await registerSession(redis, recordFromDevice('mallory', 'viewer', dev(SID1)));
      await registerSession(redis, recordFromDevice('victim', 'viewer', dev(SID2)));
      h.role = 'viewer'; h.sub = 'mallory';
      const own = await (await route.GET(new Request('http://t/api/sessions'))).json();
      expect(own.data.map((s: { sid: string }) => s.sid)).toEqual([SID1]);
      expect(own.canRevokeAny).toBe(false);
      expect((await route.GET(new Request('http://t/api/sessions?scope=all'))).status).toBe(403);
      expect((await route.DELETE(del(`sid=${SID2}`))).status).toBe(403);
      expect(await isSessionRevoked(redis, SID2)).toBe(false);
      expect((await route.DELETE(del(`sid=${SID1}`))).status).toBe(200);
      expect(await isSessionRevoked(redis, SID1)).toBe(true);
    });

    it('superadmin: melihat semua, mencabut sesi siapa pun, mencabut semua sesi satu pengguna; audit tercatat', async () => {
      const route = await import('@/app/api/sessions/route');
      await registerSession(redis, recordFromDevice('u1', 'viewer', dev(SID1)));
      await registerSession(redis, recordFromDevice('u2', 'admin', dev(SID2)));
      await registerSession(redis, recordFromDevice('u2', 'admin', dev(SID3, '3.3.3.3')));
      const all = await (await route.GET(new Request('http://t/api/sessions?scope=all'))).json();
      expect(all.data).toHaveLength(3);
      expect((await route.DELETE(del(`sid=${SID1}`))).status).toBe(200);
      expect((await (await route.DELETE(del('user=u2&all=1'))).json()).revoked).toBe(2);
      expect(await listAllSessions(redis)).toEqual([]);
      expect((await raw.lrange(KEYS.auditLog, 0, -1)).map((r) => JSON.parse(r).action)).toEqual(['session.revoke', 'session.revoke']);
      expect((await route.DELETE(del('sid=bukan-uuid'))).status).toBe(400);
      expect((await route.DELETE(del(`sid=${SID1}`))).status).toBe(404);
    });
  });

  describe('hook login', () => {
    it('login mendaftarkan sesi; IP baru (setelah ada riwayat) memicu alert, IP yang sama tidak', async () => {
      process.env.SUPERADMIN_USERNAME = 'root';
      process.env.SUPERADMIN_PASSWORD_HASH = await hashPassword('Sup3r-secret-pass');
      process.env.JWT_SECRET = 'j'.repeat(40);
      process.env.ENCRYPTION_KEY = 'd4'.repeat(32);
      process.env.GEOIP_ISP_LOOKUP = 'off';
      await writeChannel(redis, { platform: 'discord', enabled: true, minSeverity: 'info', kinds: 'all', discord: { webhookUrl: 'https://discord.com/api/webhooks/123456789012345678/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789' }, updatedAt: '', updatedBy: 'x' });
      const f = vi.fn().mockImplementation(async () => new Response(null, { status: 204 }));
      vi.stubGlobal('fetch', f);
      const headers = (ip: string) => new Headers({ 'x-forwarded-for': ip, 'user-agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/120' });

      const first = await performLogin(redis, headers('1.1.1.1'), 'root', 'Sup3r-secret-pass');
      const claims = await verifySession(first.token, process.env.JWT_SECRET!);
      expect((await listSessionsOf(redis, 'root')).map((s) => s.sid)).toEqual([claims!.sid]);
      await new Promise((r) => setTimeout(r, 50));
      expect(f).not.toHaveBeenCalled(); // login pertama: bukan "IP baru"

      await performLogin(redis, headers('1.1.1.1'), 'root', 'Sup3r-secret-pass');
      await new Promise((r) => setTimeout(r, 50));
      expect(f).not.toHaveBeenCalled(); // IP sama

      await performLogin(redis, headers('8.8.4.4'), 'root', 'Sup3r-secret-pass');
      await vi.waitFor(() => expect(f).toHaveBeenCalledTimes(1));
      const body = JSON.parse(String(f.mock.calls[0][1].body));
      expect(body.embeds[0].color).toBe(0xf43f5e); // superadmin dari IP baru = critical
      expect(JSON.stringify(body)).toContain('8.8.4.4');
      expect((await listSessionsOf(redis, 'root'))).toHaveLength(3);
    });
  });
});
