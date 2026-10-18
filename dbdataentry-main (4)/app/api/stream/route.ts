import { requireSession } from '@/lib/auth/session';
import { applyOfflineTimeout } from '@/lib/accounts';
import { envInt } from '@/lib/env';
import { listGames, readSeq } from '@/lib/games';
import { readAccounts, readLogs } from '@/lib/ingest/store';
import { clampInt, json } from '@/lib/http';
import { getRedis } from '@/lib/redis';
import type { StreamPayload } from '@/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const SLUG = /^[a-z0-9-]{1,64}$/;
// Koneksi ditutup rapi sebelum maxDuration; EventSource di browser menyambung ulang sendiri.
const MAX_STREAM_MS = 55_000;

// SSE. Hemat command: tiap tick hanya membaca 1 key penanda perubahan (logs:seq);
// data penuh dikirim hanya saat penanda berubah. Parameter: ?game=<slug>|all &limit=10..500
export async function GET(request: Request) {
  const { denied } = await requireSession();
  if (denied) return denied;

  let redis;
  try {
    redis = getRedis();
  } catch (err) {
    console.error('[stream]', err);
    return json({ success: false, message: 'Terjadi kesalahan pada server' }, 500);
  }

  const params = new URL(request.url).searchParams;
  const game = params.get('game') ?? 'all';
  if (game !== 'all' && !SLUG.test(game)) return json({ success: false, message: 'Parameter game tidak valid' }, 400);
  const limit = clampInt(params.get('limit'), 10, 500, 100);
  const interval = envInt('STREAM_INTERVAL_MS', 4000, 2000, 60000);

  const encoder = new TextEncoder();
  let closed = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let maxTimer: ReturnType<typeof setTimeout> | undefined;
  const cleanup = () => {
    closed = true;
    clearInterval(timer);
    clearTimeout(maxTimer);
  };

  const stream = new ReadableStream({
    start(controller) {
      const close = () => {
        if (closed) return;
        cleanup();
        try {
          controller.close();
        } catch {
          // sudah tertutup
        }
      };
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          close();
        }
      };

      let running = false;
      let lastSeq = -1;

      const tick = async () => {
        if (closed || running) return;
        running = true;
        try {
          const seq = await readSeq(redis);
          if (seq === lastSeq) {
            send(': keepalive\n\n');
            return;
          }
          const [logs, accounts, games] = await Promise.all([readLogs(redis, game, limit), readAccounts(redis), listGames(redis)]);
          lastSeq = seq;
          const now = Date.now();
          const payload: StreamPayload = {
            logs,
            accounts: accounts.map((a) => applyOfflineTimeout(a, now)),
            games,
            game,
            seq,
            timestamp: now,
          };
          send(`data: ${JSON.stringify(payload)}\n\n`);
        } catch (err) {
          console.error('[stream] gagal mengambil data:', err);
          send(': error\n\n');
        } finally {
          running = false;
        }
      };

      request.signal.addEventListener('abort', close);
      send('retry: 3000\n\n');
      void tick();
      timer = setInterval(tick, interval);
      maxTimer = setTimeout(close, MAX_STREAM_MS);
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
