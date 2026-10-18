// Konsumen antrean ingest. Satu pengurus aktif pada satu waktu (kunci Redis NX+EX); di dalamnya
// item diproses paralel terbatas. Berhenti saat antrean kosong atau anggaran waktu habis, lalu
// melepas kunci dengan compare-and-delete (tidak menghapus kunci milik pengurus lain).
import { processIngest } from '@/lib/ingest/process';
import { ack, acquireLock, claim, nack, queueLimits, reclaimExpired, releaseLock, type QueueItem } from '@/lib/ingest/queue';
import { emitAlert } from '@/lib/notify/emit';
import type { RedisLike } from '@/lib/redis';

export interface DrainOptions {
  budgetMs?: number;
  batchSize?: number;
  concurrency?: number;
  nowMs?: () => number;
  /** Ganti pemroses (tes). Bawaan: processIngest. */
  handler?: (redis: RedisLike, item: QueueItem) => Promise<unknown>;
}

export interface DrainReport {
  locked: boolean;
  processed: number;
  failed: number;
  dead: number;
  reclaimed: number;
  batches: number;
}

export async function processItem(redis: RedisLike, item: QueueItem): Promise<unknown> {
  const headers = new Headers(item.headers);
  return processIngest(redis, {
    verified: new Uint8Array(Buffer.from(item.bodyB64, 'base64')),
    contentType: item.contentType, headers, query: new URLSearchParams(item.query),
    startedAt: item.enqueuedAt, defaultGame: item.defaultGame, forceAccount: item.forceAccount,
  });
}

async function pool<T>(items: T[], limit: number, fn: (t: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) { const idx = i; i += 1; if (idx >= items.length) return; await fn(items[idx]); }
  }));
}

export async function drainQueue(redis: RedisLike, opts: DrainOptions = {}): Promise<DrainReport> {
  const now = opts.nowMs ?? Date.now;
  const report: DrainReport = { locked: false, processed: 0, failed: 0, dead: 0, reclaimed: 0, batches: 0 };
  const budget = opts.budgetMs ?? 8000;
  const lockTtl = Math.max(15, Math.ceil(budget / 1000) + 10);
  const token = await acquireLock(redis, lockTtl);
  if (!token) return report; // pengurus lain sedang bekerja
  report.locked = true;
  const startedAt = now();
  const handler = opts.handler ?? processItem;
  const { maxAttempts } = queueLimits();

  try {
    const re = await reclaimExpired(redis, now());
    report.reclaimed = re.retried + re.dead;
    report.dead += re.dead;

    while (now() - startedAt < budget) {
      const raws = await claim(redis, opts.batchSize ?? 50, now());
      if (raws.length === 0) break;
      report.batches += 1;
      const done: string[] = [];
      await pool(raws, opts.concurrency ?? 6, async (raw) => {
        try {
          await handler(redis, JSON.parse(raw) as QueueItem);
          done.push(raw);
        } catch (err) {
          report.failed += 1;
          console.error('[queue] item gagal diproses:', err instanceof Error ? err.message : err);
          if ((await nack(redis, raw, maxAttempts)) === 'dead') report.dead += 1;
        }
      });
      report.processed += await ack(redis, done);
    }
    if (report.dead > 0) {
      await emitAlert({ kind: 'queue.dead_letter', severity: 'critical', title: 'Item ingest masuk dead-letter', message: `${report.dead} item gagal diproses berulang kali dan dipindahkan ke dead-letter. Periksa tab Sistem > Antrean.`, fields: [{ name: 'Item', value: String(report.dead) }], dedupeKey: 'dead' }, { redis });
    }
  } finally {
    await releaseLock(redis, token).catch(() => undefined);
  }
  return report;
}
