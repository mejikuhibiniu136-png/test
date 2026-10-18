// Mesin notifikasi terpadu: validasi anti-SSRF, format per platform, retry, peredam duplikat,
// dan jaminan bahwa rahasia tidak pernah bocor ke Redis (plain), log, maupun pesan galat.
import type IORedis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { discordAdapter, parseDiscordUrl } from '@/lib/notify/adapters/discord';
import { telegramAdapter } from '@/lib/notify/adapters/telegram';
import { __resetNotifyCache, readChannel, toView, writeChannel } from '@/lib/notify/config';
import { dispatchAlert, readDeliveries } from '@/lib/notify/dispatcher';
import { emitAlert } from '@/lib/notify/emit';
import { sendWithRetry } from '@/lib/notify/transport';
import type { AlertEvent, StoredChannel } from '@/lib/notify/types';
import { KEYS } from '@/lib/keys';
import type { RedisLike } from '@/lib/redis';
import { connectTestRedis } from './helpers/redis';

const DISCORD = 'https://discord.com/api/webhooks/123456789012345678/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcdefg';
const TG_TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw_abc';
const KEY = 'c3'.repeat(32);
const event = (o: Partial<AlertEvent> = {}): AlertEvent => ({ kind: 'auth.new_ip', severity: 'warning', title: 'Login dari IP baru', message: 'u1 login', fields: [{ name: 'IP', value: '1.2.3.4' }], dedupeKey: 'u1|1.2.3.4', ...o });
const channel = (o: Partial<StoredChannel> = {}): StoredChannel => ({ platform: 'discord', enabled: true, minSeverity: 'info', kinds: 'all', discord: { webhookUrl: DISCORD }, updatedAt: '', updatedBy: 'root', ...o });
const ok = () => new Response(null, { status: 204 });
const noSleep = async () => undefined;

describe('adapter (murni)', () => {
  it('Discord: hanya host Discord + path webhook yang valid (anti-SSRF)', () => {
    expect(parseDiscordUrl(DISCORD)).not.toBeNull();
    for (const bad of ['http://discord.com/api/webhooks/123456789012345678/' + 'a'.repeat(30), 'https://evil.com/api/webhooks/123456789012345678/' + 'a'.repeat(30),
      'https://discord.com.evil.com/api/webhooks/123456789012345678/' + 'a'.repeat(30), 'https://user:pw@discord.com/api/webhooks/123456789012345678/' + 'a'.repeat(30),
      'https://discord.com:8443/api/webhooks/123456789012345678/' + 'a'.repeat(30), 'https://169.254.169.254/latest/meta-data', 'https://discord.com/api/other', 'bukan url']) {
      expect(parseDiscordUrl(bad), bad).toBeNull();
    }
  });

  it('Discord: embed patuh batas, warna per severity, tanpa mention', () => {
    const spec = discordAdapter.format(event({ title: 'x'.repeat(500), message: 'y'.repeat(9000), fields: Array.from({ length: 40 }, (_, i) => ({ name: `n${i}`, value: '@everyone `x`' })) }), { webhookUrl: DISCORD });
    const body = spec.body as { allowed_mentions: { parse: string[] }; embeds: { title: string; description: string; color: number; fields: { value: string }[] }[] };
    expect(body.allowed_mentions.parse).toEqual([]);
    expect(body.embeds[0].title.length).toBeLessThanOrEqual(256);
    expect(body.embeds[0].description.length).toBeLessThanOrEqual(4000);
    expect(body.embeds[0].fields).toHaveLength(25);
    expect(body.embeds[0].fields[0].value).toBe('`@everyone x`');
    expect(body.embeds[0].color).toBe(0xfbbf24);
  });

  it('Telegram: validasi token/chat, HTML di-escape, batas 4096', () => {
    expect(telegramAdapter.validate({ botToken: TG_TOKEN, chatId: '-1001234567890' })).toBeNull();
    expect(telegramAdapter.validate({ botToken: TG_TOKEN, chatId: '@kanal_ku' })).toBeNull();
    expect(telegramAdapter.validate({ botToken: 'salah', chatId: '-1001234567890' })).toMatch(/Token/);
    expect(telegramAdapter.validate({ botToken: TG_TOKEN, chatId: 'abc' })).toMatch(/Chat ID/);
    const spec = telegramAdapter.format(event({ title: '<script>alert(1)</script>', message: 'a & b'.repeat(2000) }), { botToken: TG_TOKEN, chatId: '-1001234567890' });
    const body = spec.body as { text: string; parse_mode: string };
    expect(spec.url).toBe(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`);
    expect(body.text).not.toContain('<script>');
    expect(body.text).toContain('&lt;script&gt;');
    expect(body.text.length).toBeLessThanOrEqual(4096);
    expect(body.parse_mode).toBe('HTML');
  });
});

describe('transport', () => {
  const opts = { retryAfter: discordAdapter.retryAfterSeconds, secrets: [DISCORD, 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcdefg'] };
  const spec = { url: 'https://discord.com/x', body: {} };

  it('429 -> menunggu sesuai retry_after lalu berhasil', async () => {
    const sleeps: number[] = [];
    const f = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ retry_after: 1.5 }), { status: 429 })).mockResolvedValueOnce(ok());
    const r = await sendWithRetry(spec, opts, { fetch: f as never, sleep: async (ms) => { sleeps.push(ms); }, random: () => 0 });
    expect(r).toMatchObject({ ok: true, attempts: 2 });
    expect(sleeps[0]).toBeGreaterThanOrEqual(1500);
  });

  it('4xx (selain 429) tidak diulang; 5xx diulang sampai batas', async () => {
    const f4 = vi.fn().mockResolvedValue(new Response('{}', { status: 404 }));
    expect(await sendWithRetry(spec, opts, { fetch: f4 as never, sleep: noSleep })).toMatchObject({ ok: false, status: 404, attempts: 1 });
    const f5 = vi.fn().mockImplementation(async () => new Response('{}', { status: 502 }));
    expect(await sendWithRetry(spec, opts, { fetch: f5 as never, sleep: noSleep })).toMatchObject({ ok: false, status: 502, attempts: 3 });
    expect(f5).toHaveBeenCalledTimes(3);
  });

  it('retry_after yang terlalu lama untuk serverless: menyerah, tidak tidur', async () => {
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify({ retry_after: 60 }), { status: 429 }));
    const sleep = vi.fn();
    expect((await sendWithRetry(spec, opts, { fetch: f as never, sleep })).ok).toBe(false);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('galat jaringan: pesan galat tidak memuat URL/token', async () => {
    const f = vi.fn().mockRejectedValue(new Error(`connect ECONNREFUSED ${DISCORD}`));
    const r = await sendWithRetry(spec, opts, { fetch: f as never, sleep: noSleep });
    expect(r.error).toBe('galat jaringan');
    expect(JSON.stringify(r)).not.toContain('AbCdEf');
  });
});

const conn = await connectTestRedis();
const d = conn ? describe : describe.skip;

d('dispatcher + konfigurasi tersegel (Redis sungguhan)', () => {
  let redis: RedisLike;
  let raw: IORedis;
  beforeAll(() => { redis = conn!.redis; raw = conn!.raw; });
  afterAll(async () => { await raw?.flushdb(); raw?.disconnect(); delete process.env.ENCRYPTION_KEY; });
  beforeEach(async () => { await raw.flushdb(); process.env.ENCRYPTION_KEY = KEY; __resetNotifyCache(); });

  it('URL/token disegel di Redis: tidak ada plaintext, ChannelView hanya petunjuk tersamar', async () => {
    await writeChannel(redis, channel());
    const stored = (await raw.hget(KEYS.notifyConfig, 'channel'))!;
    expect(stored.startsWith('dbde2.')).toBe(true);
    expect(stored).not.toContain('AbCdEf');
    expect(stored).not.toContain('discord.com');
    const view = toView(await readChannel(redis, { fresh: true }));
    expect(view.hint).toBeTruthy();
    expect(JSON.stringify(view)).not.toContain('AbCdEfGhIjKlMnOpQrStUvWxYz');
    // ciphertext dipindah ke field lain -> tidak bisa dibuka
    await raw.hset(KEYS.settings, 'WEBHOOK_SECRET', stored);
    const { readSecretSetting } = await import('@/lib/settings');
    expect(await readSecretSetting(redis, 'WEBHOOK_SECRET')).toBeNull();
  });

  it('mengirim sesuai platform, mencatat hasil tanpa rahasia', async () => {
    await writeChannel(redis, channel());
    const f = vi.fn().mockImplementation(async () => ok());
    const res = await dispatchAlert(redis, event(), { fetch: f as never, sleep: noSleep });
    expect(res.status).toBe('sent');
    expect(String(f.mock.calls[0][0])).toContain('discord.com/api/webhooks/');
    const log = await readDeliveries(redis);
    expect(log[0]).toMatchObject({ ok: true, platform: 'discord', kind: 'auth.new_ip' });
    expect(JSON.stringify(log)).not.toContain('AbCdEf');
  });

  it('beralih ke Telegram: format & host berubah, Discord tidak dipanggil', async () => {
    await writeChannel(redis, channel({ platform: 'telegram', discord: undefined, telegram: { botToken: TG_TOKEN, chatId: '-1001234567890' } }));
    const f = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    expect((await dispatchAlert(redis, event(), { fetch: f as never, sleep: noSleep })).status).toBe('sent');
    expect(String(f.mock.calls[0][0])).toMatch(/^https:\/\/api\.telegram\.org\/bot/);
  });

  it('filter: nonaktif, jenis tidak dilanggan, severity di bawah minimum, belum dikonfigurasi', async () => {
    const f = vi.fn().mockImplementation(async () => ok());
    const deps = { fetch: f as never, sleep: noSleep };
    expect(await dispatchAlert(redis, event(), deps)).toEqual({ status: 'skipped', reason: 'not_configured' });
    await writeChannel(redis, channel({ enabled: false }));
    expect(await dispatchAlert(redis, event(), deps)).toEqual({ status: 'skipped', reason: 'disabled' });
    await writeChannel(redis, channel({ kinds: ['queue.backlog'] }));
    expect(await dispatchAlert(redis, event(), deps)).toEqual({ status: 'skipped', reason: 'kind_filtered' });
    await writeChannel(redis, channel({ minSeverity: 'critical' }));
    expect(await dispatchAlert(redis, event(), deps)).toEqual({ status: 'skipped', reason: 'below_severity' });
    expect(f).not.toHaveBeenCalled();
  });

  it('peredam duplikat: kejadian sama dalam jendela hanya dikirim sekali; kunci berbeda lolos', async () => {
    await writeChannel(redis, channel());
    const f = vi.fn().mockImplementation(async () => ok());
    const deps = { fetch: f as never, sleep: noSleep };
    expect((await dispatchAlert(redis, event(), deps)).status).toBe('sent');
    expect(await dispatchAlert(redis, event(), deps)).toEqual({ status: 'skipped', reason: 'deduped' });
    expect((await dispatchAlert(redis, event({ dedupeKey: 'u2|9.9.9.9' }), deps)).status).toBe('sent');
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('konfigurasi rusak / dipalsukan: dilewati, tidak melempar', async () => {
    await raw.hset(KEYS.notifyConfig, 'channel', 'bukan-amplop');
    expect(await dispatchAlert(redis, event())).toEqual({ status: 'skipped', reason: 'not_configured' });
    await writeChannel(redis, channel({ discord: { webhookUrl: 'https://evil.com/x' } }));
    expect(await dispatchAlert(redis, event())).toEqual({ status: 'skipped', reason: 'invalid_config' });
  });

  it('emitAlert tidak melempar walau Redis rusak dan memakai scheduler yang diberikan', async () => {
    const broken = { hget: async () => { throw new Error('down'); } } as unknown as RedisLike;
    await expect(emitAlert(event(), { redis: broken, schedule: (t) => t().then(() => undefined) })).resolves.toBeUndefined();
  });
});
