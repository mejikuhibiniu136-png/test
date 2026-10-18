// Unified Webhook Dispatcher Engine.
//
//   AlertEvent --> [konfigurasi tersegel] --> aktif? --> jenis dilanggan? --> severity >= minimum?
//              --> peredam duplikat (SET NX EX) --> adapter.format --> sendWithRetry --> catat hasil
//
// Seluruh jalur TIDAK PERNAH melempar: notifikasi adalah efek samping, tidak boleh menggagalkan
// login, ingest, atau aksi admin yang memicunya (pola sama dengan lib/audit.ts).
import { createHash, randomUUID } from 'node:crypto';
import { KEYS } from '@/lib/keys';
import { resolveAdapter } from '@/lib/notify/adapters';
import { readChannel } from '@/lib/notify/config';
import { sendWithRetry, type SendOutcome, type TransportDeps } from '@/lib/notify/transport';
import { DEFAULT_DEDUPE_SECONDS, SEVERITY_RANK, type AlertEvent, type DeliveryRecord, type StoredChannel } from '@/lib/notify/types';
import { getRedis, type RedisLike } from '@/lib/redis';

export const DELIVERY_LOG_MAX = 100;

export type DispatchResult =
  | { status: 'sent'; outcome: SendOutcome }
  | { status: 'failed'; outcome: SendOutcome }
  | { status: 'skipped'; reason: 'not_configured' | 'disabled' | 'kind_filtered' | 'below_severity' | 'deduped' | 'invalid_config' | 'error' };

export interface DispatchDeps extends TransportDeps {
  nowMs?: number;
  /** Abaikan filter jenis/severity/peredam (dipakai tombol "Kirim uji"). */
  force?: boolean;
  /** Pakai konfigurasi ini, bukan yang tersimpan (uji sebelum disimpan). */
  channel?: StoredChannel;
}

const dedupeHash = (e: AlertEvent) => createHash('sha256').update(`${e.kind}|${e.dedupeKey ?? ''}`).digest('hex').slice(0, 24);

async function record(redis: RedisLike, rec: DeliveryRecord): Promise<void> {
  try {
    await redis.lpush(KEYS.notifyLog, JSON.stringify(rec));
    await redis.ltrim(KEYS.notifyLog, 0, DELIVERY_LOG_MAX - 1);
  } catch (err) {
    console.error('[notify] gagal mencatat hasil:', err);
  }
}

export async function dispatchAlert(redis: RedisLike, event: AlertEvent, deps: DispatchDeps = {}): Promise<DispatchResult> {
  try {
    const channel = deps.channel ?? (await readChannel(redis, { nowMs: deps.nowMs }));
    if (!channel) return { status: 'skipped', reason: 'not_configured' };
    if (!deps.force) {
      if (!channel.enabled) return { status: 'skipped', reason: 'disabled' };
      if (channel.kinds !== 'all' && !channel.kinds.includes(event.kind)) return { status: 'skipped', reason: 'kind_filtered' };
      if (SEVERITY_RANK[event.severity] < SEVERITY_RANK[channel.minSeverity]) return { status: 'skipped', reason: 'below_severity' };
    }

    const resolved = resolveAdapter(channel);
    if (!resolved || resolved.adapter.validate(resolved.target)) return { status: 'skipped', reason: 'invalid_config' };

    const window = event.dedupeSeconds ?? DEFAULT_DEDUPE_SECONDS[event.kind];
    if (!deps.force && window > 0) {
      const first = await redis.set(KEYS.notifyDedupe(dedupeHash(event)), '1', { nx: true, ex: window });
      if (!first) return { status: 'skipped', reason: 'deduped' };
    }

    const at = new Date(deps.nowMs ?? Date.now()).toISOString();
    const spec = resolved.adapter.format({ ...event, at: event.at ?? at }, resolved.target);
    const outcome = await sendWithRetry(spec, { retryAfter: resolved.adapter.retryAfterSeconds, secrets: resolved.adapter.secrets(resolved.target) }, deps);
    await record(redis, {
      id: randomUUID(), at, kind: event.kind, severity: event.severity, platform: channel.platform, title: event.title.slice(0, 120),
      ok: outcome.ok, status: outcome.status, attempts: outcome.attempts, error: outcome.error,
    });
    return { status: outcome.ok ? 'sent' : 'failed', outcome };
  } catch (err) {
    console.error('[notify] dispatch gagal:', err instanceof Error ? err.message : 'unknown');
    return { status: 'skipped', reason: 'error' };
  }
}

export async function readDeliveries(redis: RedisLike, limit = 20): Promise<DeliveryRecord[]> {
  const raw = await redis.lrange(KEYS.notifyLog, 0, Math.max(1, limit) - 1);
  return (raw ?? []).map((r) => { try { return typeof r === 'string' ? (JSON.parse(r) as DeliveryRecord) : (r as DeliveryRecord); } catch { return null; } }).filter((r): r is DeliveryRecord => r !== null && typeof r.kind === 'string');
}
