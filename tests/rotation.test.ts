// Rotasi KEK end-to-end: manual (tombol) dan otomatis (cron) mencakup secret pengaturan DAN kredensial
// notifikasi, tanpa mengubah ciphertext payload dan tanpa merusak data lama.
import type IORedis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetNotifyCache, readChannel, writeChannel } from '@/lib/notify/config';
import { dispatchAlert } from '@/lib/notify/dispatcher';
import type { StoredChannel } from '@/lib/notify/types';
import { KEYS } from '@/lib/keys';
import type { RedisLike } from '@/lib/redis';
import { inspectSecrets, readSecretSetting, writeSecretSetting } from '@/lib/settings';
import { recordSecurityEvent } from '@/lib/securityStats';
import { connectTestRedis } from './helpers/redis';

const h = vi.hoisted(() => ({ redis: null as unknown }));
vi.mock('@/lib/redis', () => ({ getRedis: () => h.redis }));

const A = 'a1'.repeat(32);
const B = 'b2'.repeat(32);
const CH: StoredChannel = { platform: 'telegram', enabled: true, minSeverity: 'info', kinds: 'all', telegram: { botToken: '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw_abc', chatId: '-1001234567890' }, updatedAt: '', updatedBy: 'root' };

const conn = await connectTestRedis();
const d = conn ? describe : describe.skip;
d('rotasi KEK menyeluruh (Redis sungguhan)', () => {
  let redis: RedisLike; let raw: IORedis;
  beforeAll(() => { redis = conn!.redis; raw = conn!.raw; h.redis = redis; });
  afterAll(async () => { await raw?.flushdb(); raw?.disconnect(); for (const k of ['ENCRYPTION_KEY', 'ENCRYPTION_KEY_PREVIOUS', 'CRON_SECRET', 'SECURITY_SPIKE_PER_HOUR']) delete process.env[k]; vi.unstubAllGlobals(); });
  beforeEach(async () => { await raw.flushdb(); __resetNotifyCache(); process.env.ENCRYPTION_KEY = A; delete process.env.ENCRYPTION_KEY_PREVIOUS; });

  it('KEK diganti: status melaporkan stale dari DUA store; cron menyapu keduanya; payload tidak disentuh', async () => {
    await writeSecretSetting(redis, 'API_KEY', 'kunci-api-rahasia');
    await writeChannel(redis, CH);
    const beforeCt = (await raw.hget(KEYS.notifyConfig, 'channel'))!.split('.')[5];

    process.env.ENCRYPTION_KEY = B; process.env.ENCRYPTION_KEY_PREVIOUS = A; // operator merotasi kunci
    expect(await inspectSecrets(redis)).toEqual({ previousKey: 'valid', stale: 2, undecryptable: 0 });

    process.env.CRON_SECRET = 'cron-secret-123';
    const cron = await import('@/app/api/cron/crypto-rotate/route');
    const res = await cron.GET(new Request('http://t', { headers: { authorization: 'Bearer cron-secret-123' } }));
    expect((await res.json()).data).toEqual({ rotated: 2, alreadyCurrent: 0, failed: 0 });
    expect((await cron.GET(new Request('http://t'))).status).toBe(401); // tanpa secret ditolak
    expect((await (await cron.GET(new Request('http://t', { headers: { authorization: 'Bearer cron-secret-123' } }))).json()).data).toEqual({ rotated: 0, alreadyCurrent: 2, failed: 0 }); // idempoten

    expect((await raw.hget(KEYS.notifyConfig, 'channel'))!.split('.')[5]).toBe(beforeCt); // ciphertext payload identik
    delete process.env.ENCRYPTION_KEY_PREVIOUS; // kunci lama boleh dibuang sekarang
    __resetNotifyCache();
    expect(await readSecretSetting(redis, 'API_KEY')).toBe('kunci-api-rahasia');
    expect((await readChannel(redis, { fresh: true }))?.telegram?.chatId).toBe('-1001234567890');

    const f = vi.fn().mockImplementation(async () => Response.json({ ok: true }));
    expect((await dispatchAlert(redis, { kind: 'system.test', severity: 'info', title: 't', message: 'm' }, { fetch: f as never, force: true })).status).toBe('sent');
  });

  it('lonjakan keamanan memicu alert tepat di ambang, diredam dedupe, kunci jam berbeda terpisah', async () => {
    process.env.SECURITY_SPIKE_PER_HOUR = '5';
    await writeChannel(redis, { ...CH, platform: 'discord', telegram: undefined, discord: { webhookUrl: 'https://discord.com/api/webhooks/123456789012345678/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789' } });
    const f = vi.fn().mockImplementation(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', f);
    const t0 = Date.parse('2026-10-17T10:00:00Z');
    for (let i = 0; i < 4; i += 1) await recordSecurityEvent(redis, 'hmac_fail', t0 + i);
    await new Promise((r) => setTimeout(r, 40));
    expect(f).not.toHaveBeenCalled(); // di bawah ambang
    await recordSecurityEvent(redis, 'hmac_fail', t0 + 5);
    await vi.waitFor(() => expect(f).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String(f.mock.calls[0][1].body)).embeds[0].title).toContain('HMAC');
    for (let i = 0; i < 5; i += 1) await recordSecurityEvent(redis, 'hmac_fail', t0 + 10 + i); // kelipatan 10 -> dedupe meredam
    await new Promise((r) => setTimeout(r, 60));
    expect(f).toHaveBeenCalledTimes(1);
  });
});
