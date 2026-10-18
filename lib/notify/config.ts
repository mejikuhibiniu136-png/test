// Penyimpanan konfigurasi saluran notifikasi. URL webhook / bot token disegel (envelope encryption
// berlapis) sebelum menyentuh Redis, dengan konteks "notify:channel". Browser hanya menerima ChannelView.
import { KEYS } from '@/lib/keys';
import { resolveAdapter } from '@/lib/notify/adapters';
import { ALERT_KINDS, type AlertKind, type ChannelView, type StoredChannel } from '@/lib/notify/types';
import type { RedisLike } from '@/lib/redis';
import { sealJson, tryOpenAny, type SealedHash } from '@/lib/security/crypto';

export const CHANNEL_FIELD = 'channel';
export const CHANNEL_CONTEXT = 'notify:channel';
export const NOTIFY_SEALED: SealedHash = { key: KEYS.notifyConfig, fields: [CHANNEL_FIELD], contextFor: () => CHANNEL_CONTEXT };

const CACHE_MS = 10_000;
let cache: { value: StoredChannel | null; at: number } | null = null;
export const __resetNotifyCache = () => { cache = null; };

const isKind = (k: unknown): k is AlertKind => (ALERT_KINDS as readonly unknown[]).includes(k);

function normalize(raw: unknown): StoredChannel | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Partial<StoredChannel>;
  if (c.platform !== 'discord' && c.platform !== 'telegram') return null;
  const kinds = c.kinds === 'all' || !Array.isArray(c.kinds) ? 'all' : c.kinds.filter(isKind);
  return {
    platform: c.platform,
    enabled: c.enabled === true,
    minSeverity: c.minSeverity === 'warning' || c.minSeverity === 'critical' ? c.minSeverity : 'info',
    kinds,
    discord: c.discord, telegram: c.telegram,
    updatedAt: typeof c.updatedAt === 'string' ? c.updatedAt : '',
    updatedBy: typeof c.updatedBy === 'string' ? c.updatedBy : '',
  };
}

export async function readChannel(redis: RedisLike, opts: { fresh?: boolean; nowMs?: number } = {}): Promise<StoredChannel | null> {
  const now = opts.nowMs ?? Date.now();
  if (!opts.fresh && cache && now - cache.at < CACHE_MS) return cache.value;
  const sealed = await redis.hget(KEYS.notifyConfig, CHANNEL_FIELD);
  const plain = typeof sealed === 'string' ? tryOpenAny(sealed, CHANNEL_CONTEXT) : null;
  let value: StoredChannel | null = null;
  if (plain) { try { value = normalize(JSON.parse(plain)); } catch { value = null; } }
  cache = { value, at: now };
  return value;
}

export async function writeChannel(redis: RedisLike, channel: StoredChannel): Promise<void> {
  await redis.hset(KEYS.notifyConfig, { [CHANNEL_FIELD]: sealJson(channel, CHANNEL_CONTEXT) });
  cache = null;
}

export async function clearChannel(redis: RedisLike): Promise<void> {
  await redis.hdel(KEYS.notifyConfig, CHANNEL_FIELD);
  cache = null;
}

export function toView(channel: StoredChannel | null): ChannelView {
  if (!channel) return { configured: false, platform: null, enabled: false, minSeverity: 'info', kinds: 'all', hint: null, updatedAt: null, updatedBy: null };
  const r = resolveAdapter(channel);
  return {
    configured: Boolean(r), platform: channel.platform, enabled: channel.enabled, minSeverity: channel.minSeverity, kinds: channel.kinds,
    hint: r ? r.adapter.hint(r.target) : null, updatedAt: channel.updatedAt || null, updatedBy: channel.updatedBy || null,
  };
}
