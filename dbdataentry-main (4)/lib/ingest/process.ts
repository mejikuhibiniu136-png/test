// Inti pemrosesan satu payload ingest yang sudah terverifikasi: parse -> deteksi game -> tulis atomik.
// Dipakai bersama oleh jalur langsung (handler.ts) dan konsumen antrean (drain.ts), sehingga perilaku
// kedua mode identik.
import { randomUUID } from 'node:crypto';
import { isAccountStatus, detectEventType, detectGameName } from '@/lib/ingest/detect';
import { parsePayload } from '@/lib/ingest/parse';
import { writeAccountAndLog, writeLogOnly } from '@/lib/ingest/store';
import { isHeartbeatEvent, mergeAccount, normalizeUsername } from '@/lib/accounts';
import { resolveGame } from '@/lib/games';
import { HttpError } from '@/lib/http';
import { recordSecurityEvent } from '@/lib/securityStats';
import type { RedisLike } from '@/lib/redis';
import { accountPayloadSchema } from '@/schemas/account';
import type { LogEntry } from '@/types';

export interface ProcessInput {
  verified: Uint8Array;
  contentType: string | null;
  headers: Headers;
  query: URLSearchParams;
  startedAt: number;
  defaultGame?: string;
  forceAccount?: boolean;
}

export interface ProcessResult {
  game: string;
  gameName: string;
  newTable: boolean;
  format: string;
  bytes: number;
  id: string | null;
  logged: boolean;
  account?: string;
}

export async function processIngest(redis: RedisLike, input: ProcessInput): Promise<ProcessResult> {
  const { verified, contentType, headers, query, startedAt } = input;
  const parsed = await parsePayload(verified, contentType);
  const gameName = detectGameName(parsed.data, headers, query, input.defaultGame);
  const game = await resolveGame(redis, gameName);
  const eventType = detectEventType(headers, parsed.data);

  const makeLog = (nowMs: number): LogEntry => ({
    id: randomUUID(), game: game.slug, gameName: game.name, eventType, payload: parsed.data, format: parsed.format,
    bytes: verified.length, processingTimeMs: Math.max(0, nowMs - startedAt), receivedAt: new Date(nowMs).toISOString(),
  });
  const base = { game: game.slug, gameName: game.name, newTable: game.isNew, format: parsed.format, bytes: verified.length };

  try {
    if (input.forceAccount || isAccountStatus(parsed.data)) {
      const acc = accountPayloadSchema.safeParse(parsed.data);
      const username = acc.success ? normalizeUsername(acc.data.username) : null;
      if (acc.success && username) {
        const res = await writeAccountAndLog(redis, game, username, (existing) => {
          const nowMs = Date.now();
          const { account, newSession } = mergeAccount(existing, acc.data, { nowMs, latencyMs: nowMs - startedAt });
          // Heartbeat rutin hanya memperbarui akun; log ditulis saat sesi mulai, offline, atau event lain.
          const shouldLog = newSession || account.state === 'OFFLINE' || !isHeartbeatEvent(acc.data.event);
          return { account, log: shouldLog ? makeLog(nowMs) : null };
        });
        return { ...base, id: res.log?.id ?? null, logged: res.log !== null, account: res.account.state };
      }
      // Bentuk status akun tidak valid: tetap disimpan sebagai log biasa, tidak dibuang.
    }
    const log = makeLog(Date.now());
    await writeLogOnly(redis, game, log);
    return { ...base, id: log.id, logged: true };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    console.error('[ingest] gagal menulis ke Redis:', err);
    await recordSecurityEvent(redis, 'ingest_error'); // bahan alert lonjakan error
    throw new HttpError(503, 'Penyimpanan sementara tidak tersedia, coba kirim ulang', { 'Retry-After': '5' });
  }
}
