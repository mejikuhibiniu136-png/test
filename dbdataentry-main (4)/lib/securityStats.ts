// Penghitung kejadian keamanan receiver untuk panel Sistem (24 jam terakhir).
// Satu hash per hari UTC, field "HH:jenis"; key kedaluwarsa sendiri setelah 3 hari.
// Mencatat tidak pernah melempar: statistik tidak boleh mengganggu jalur ingest.
import { envInt } from '@/lib/env';
import { KEYS } from '@/lib/keys';
import { emitAlert } from '@/lib/notify/emit';
import type { RedisLike } from '@/lib/redis';
import type { SecurityStats } from '@/types';

export type SecurityEvent = 'hmac_fail' | 'auth_fail' | 'rate_limited' | 'ingest_error';

const SPIKE_COPY: Record<SecurityEvent, { kind: 'security.spike' | 'ingest.error_spike'; title: string }> = {
  hmac_fail: { kind: 'security.spike', title: 'Lonjakan tanda tangan HMAC gagal' },
  auth_fail: { kind: 'security.spike', title: 'Lonjakan autentikasi API key gagal' },
  rate_limited: { kind: 'security.spike', title: 'Lonjakan request terkena rate limit' },
  ingest_error: { kind: 'ingest.error_spike', title: 'Lonjakan error penulisan ingest' },
};

const HOUR_MS = 3_600_000;
const WINDOW_HOURS = 24;
const KEEP_SECONDS = 3 * 86_400;

export async function recordSecurityEvent(redis: RedisLike, type: SecurityEvent, nowMs = Date.now()): Promise<void> {
  try {
    const iso = new Date(nowMs).toISOString();
    const key = KEYS.securityStats(iso.slice(0, 10));
    const count = await redis.hincrby(key, `${iso.slice(11, 13)}:${type}`, 1);
    if (Number(count) === 1) await redis.expire(key, KEEP_SECONDS);

    // Lonjakan: hitungan jam ini mencapai ambang (dan kelipatannya). Pengiriman ulang diredam dispatcher
    // (jendela dedupe), jadi kelipatan hanya menaikkan severity informasi, bukan membanjiri kanal.
    const threshold = envInt('SECURITY_SPIKE_PER_HOUR', 50, 5, 100_000);
    const n = Number(count);
    if (n >= threshold && n % threshold === 0) {
      const copy = SPIKE_COPY[type];
      await emitAlert({
        kind: copy.kind, severity: n >= threshold * 4 ? 'critical' : 'warning', title: copy.title,
        message: `${n} kejadian "${type}" tercatat pada jam ${iso.slice(11, 13)}:00 UTC (ambang ${threshold}/jam).`,
        fields: [{ name: 'Jenis', value: type }, { name: 'Jumlah jam ini', value: String(n) }], dedupeKey: `${type}|${iso.slice(0, 13)}`,
      }, { redis });
    }
  } catch (err) {
    console.error('[security-stats] gagal mencatat:', err);
  }
}

export async function readSecurityStats(redis: RedisLike, nowMs = Date.now()): Promise<SecurityStats> {
  const windowStart = Math.floor(nowMs / HOUR_MS) * HOUR_MS - (WINDOW_HOURS - 1) * HOUR_MS;
  const days = [new Date(nowMs), new Date(nowMs - 86_400_000)].map((d) => d.toISOString().slice(0, 10));
  const hashes = await Promise.all(days.map((day) => redis.hgetall(KEYS.securityStats(day))));
  const out: SecurityStats = { windowHours: WINDOW_HOURS, hmacFail: 0, authFail: 0, rateLimited: 0 };
  hashes.forEach((hash, i) => {
    for (const [field, value] of Object.entries(hash ?? {})) {
      const [hour, type] = field.split(':');
      const hourStart = Date.parse(`${days[i]}T${hour}:00:00.000Z`);
      const n = Number(value);
      if (!Number.isFinite(hourStart) || hourStart < windowStart || !Number.isFinite(n)) continue;
      if (type === 'hmac_fail') out.hmacFail += n;
      else if (type === 'auth_fail') out.authFail += n;
      else if (type === 'rate_limited') out.rateLimited += n;
    }
  });
  return out;
}
