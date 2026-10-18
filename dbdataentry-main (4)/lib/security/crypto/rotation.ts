// Rotasi KEK untuk nilai tersimpan di hash Redis. Dua mode:
//   - manual   : tombol Superadmin / route POST /api/admin/encryption/rotate
//   - otomatis : cron /api/cron/crypto-rotate (menyapu setelah operator mengganti ENCRYPTION_KEY)
// Keduanya memakai fungsi yang sama dan aman diulang (idempoten). Penulisan memakai compare-and-set
// sehingga nilai yang baru diganti pengguna di sela-sela rotasi tidak tertimpa.
import type { RedisLike } from '@/lib/redis';
import { classify, isEnvelope, rewrap, sealString } from '@/lib/security/crypto/envelope';
import { loadKeyring } from '@/lib/security/crypto/keyring';

export const CAS_HSET = `
if redis.call('HGET', KEYS[1], ARGV[1]) == ARGV[2] then
  redis.call('HSET', KEYS[1], ARGV[1], ARGV[3])
  return 1
end
return 0
`;

export interface RotationReport {
  rotated: number;
  alreadyCurrent: number;
  failed: number;
}

export interface SealedHash {
  key: string;
  /** Daftar field yang berisi nilai tersegel, atau 'all' untuk seluruh field hash. */
  fields: readonly string[] | 'all';
  contextFor: (field: string) => string;
}

async function fieldsOf(redis: RedisLike, h: SealedHash): Promise<string[]> {
  if (h.fields !== 'all') return [...h.fields];
  return Object.keys((await redis.hgetall(h.key)) ?? {});
}

/** Status tanpa menulis apa pun: jumlah nilai yang masih memakai KEK lama / tidak bisa dibuka. */
export async function inspectSealedHash(redis: RedisLike, h: SealedHash): Promise<{ stale: number; legacy: number; undecryptable: number }> {
  const ring = loadKeyring();
  const out = { stale: 0, legacy: 0, undecryptable: 0 };
  for (const field of await fieldsOf(redis, h)) {
    const raw = await redis.hget(h.key, field);
    if (typeof raw !== 'string' || raw.length === 0) continue;
    const { state } = classify(raw, h.contextFor(field), ring);
    if (state === 'stale') out.stale += 1;
    else if (state === 'legacy') out.legacy += 1;
    else if (state === 'broken') out.undecryptable += 1;
  }
  return out;
}

/**
 * Menyegel ulang semua nilai di `h` dengan KEK aktif.
 *  - amplop v2 dengan KEK lama  -> re-wrap DEK saja (payload tidak disentuh)
 *  - format legacy iv:tag:data  -> dibuka lalu disegel sebagai amplop v2 (upgrade)
 */
export async function rotateSealedHash(redis: RedisLike, h: SealedHash): Promise<RotationReport> {
  const ring = loadKeyring();
  const report: RotationReport = { rotated: 0, alreadyCurrent: 0, failed: 0 };
  for (const field of await fieldsOf(redis, h)) {
    const raw = await redis.hget(h.key, field);
    if (typeof raw !== 'string' || raw.length === 0) continue;
    const ctx = h.contextFor(field);
    const { state, plain } = classify(raw, ctx, ring);
    if (state === 'current') { report.alreadyCurrent += 1; continue; }
    if (state === 'broken' || plain === null) { report.failed += 1; continue; }
    try {
      const next = state === 'stale' && isEnvelope(raw) ? rewrap(raw, ctx, ring) : sealString(plain, ctx, ring);
      const applied = await redis.eval(CAS_HSET, [h.key], [field, raw, next]);
      if (Number(applied) === 1) report.rotated += 1;
      else report.failed += 1;
    } catch {
      report.failed += 1;
    }
  }
  return report;
}

export const sumReports = (list: RotationReport[]): RotationReport =>
  list.reduce((a, r) => ({ rotated: a.rotated + r.rotated, alreadyCurrent: a.alreadyCurrent + r.alreadyCurrent, failed: a.failed + r.failed }), { rotated: 0, alreadyCurrent: 0, failed: 0 });
