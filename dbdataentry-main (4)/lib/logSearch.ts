// Pencarian log full-text di sisi server + ekspor streaming.
//
// Sintaks kueri (semua istilah digabung dengan AND, tidak peka huruf besar/kecil):
//   kata            substring pada nama game, jenis event, dan seluruh payload
//   "frasa persis"  frasa dengan spasi
//   -kata           kecualikan
//   event:Win  user:alice  game:anime-dice  format:json    filter per kolom
//
// Skala: log disimpan sebagai list Redis berbatas (LOG_MAX_* <= 5000 per tabel), jadi pemindaian
// linear di Node murah (<= ~5000 entri per kueri). Bila batas itu dinaikkan jauh, ganti dengan indeks
// (Upstash Search / RediSearch); antarmuka di bawah tetap sama.
import { csvLine, LOG_CSV_HEADERS, logCsvRow } from '@/lib/logStats';
import { KEYS } from '@/lib/keys';
import { parseStored } from '@/lib/http';
import type { RedisLike } from '@/lib/redis';
import type { LogEntry } from '@/types';

export const MAX_SCAN = 5000;
const CHUNK = 500;
const HAYSTACK_MAX = 20_000;

export interface ParsedQuery {
  terms: string[];
  excluded: string[];
  fields: { event: string[]; user: string[]; game: string[]; format: string[] };
}

export function parseQuery(q: string): ParsedQuery {
  const out: ParsedQuery = { terms: [], excluded: [], fields: { event: [], user: [], game: [], format: [] } };
  const re = /(-?)(?:(event|user|game|format):)?(?:"([^"]*)"|(\S+))/gi;
  for (const m of q.slice(0, 500).matchAll(re)) {
    const neg = m[1] === '-';
    const field = m[2]?.toLowerCase() as keyof ParsedQuery['fields'] | undefined;
    const value = (m[3] ?? m[4] ?? '').trim().toLowerCase();
    if (!value) continue;
    if (neg) out.excluded.push(value);
    else if (field) out.fields[field].push(value);
    else out.terms.push(value);
  }
  return out;
}

const haystacks = new WeakMap<LogEntry, string>();
function haystack(log: LogEntry): string {
  let h = haystacks.get(log);
  if (h === undefined) {
    let body = '';
    try { body = JSON.stringify(log.payload ?? {}); } catch { body = ''; }
    h = `${log.gameName} ${log.eventType} ${body}`.slice(0, HAYSTACK_MAX).toLowerCase();
    haystacks.set(log, h);
  }
  return h;
}

export interface LogQuery {
  q?: string;
  /** Batas bawah (inklusif), ISO-8601 UTC. */
  from?: string;
  /** Batas atas (inklusif), ISO-8601 UTC. */
  to?: string;
}

export function matches(log: LogEntry, p: ParsedQuery, q: LogQuery): boolean {
  if (q.from && log.receivedAt < q.from) return false;
  if (q.to && log.receivedAt > q.to) return false;
  const h = haystack(log);
  for (const t of p.terms) if (!h.includes(t)) return false;
  for (const t of p.excluded) if (h.includes(t)) return false;
  const ev = String(log.eventType ?? '').toLowerCase();
  const user = String(log.payload?.username ?? '').toLowerCase();
  const game = `${log.game} ${log.gameName}`.toLowerCase();
  for (const v of p.fields.event) if (!ev.includes(v)) return false;
  for (const v of p.fields.user) if (!user.includes(v)) return false;
  for (const v of p.fields.game) if (!game.includes(v)) return false;
  for (const v of p.fields.format) if (String(log.format).toLowerCase() !== v) return false;
  return true;
}

/** "2026-10-17" -> awal/akhir hari UTC; ISO lengkap dipakai apa adanya; selain itu null. */
export function parseBound(raw: string | null | undefined, edge: 'from' | 'to'): string | null | 'invalid' {
  if (!raw) return null;
  const t = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    const d = new Date(`${t}T${edge === 'from' ? '00:00:00.000' : '23:59:59.999'}Z`);
    return Number.isNaN(d.getTime()) ? 'invalid' : d.toISOString();
  }
  const d = new Date(t);
  return Number.isNaN(d.getTime()) || t.length > 40 ? 'invalid' : d.toISOString();
}

const listKey = (game: string) => (game === 'all' ? KEYS.streamLogs : KEYS.gameLogs(game));

async function* scan(redis: RedisLike, game: string, max = MAX_SCAN): AsyncGenerator<LogEntry[]> {
  for (let start = 0; start < max; start += CHUNK) {
    const raw = await redis.lrange(listKey(game), start, Math.min(start + CHUNK, max) - 1);
    if (!raw?.length) return;
    yield raw.map((r) => parseStored<LogEntry>(r)).filter((l): l is LogEntry => l !== null);
    if (raw.length < CHUNK) return;
  }
}

// Urutan deterministik: receivedAt menurun, lalu id menurun. Kursor = posisi terakhir pada urutan itu,
// jadi halaman berikutnya tetap benar walau log baru masuk di antara dua permintaan.
const cmp = (a: LogEntry, b: LogEntry) => (a.receivedAt === b.receivedAt ? (a.id < b.id ? 1 : a.id > b.id ? -1 : 0) : a.receivedAt < b.receivedAt ? 1 : -1);

export const encodeCursor = (l: LogEntry) => Buffer.from(JSON.stringify({ at: l.receivedAt, id: l.id })).toString('base64url');
export function decodeCursor(c: string | null | undefined): { at: string; id: string } | null {
  if (!c) return null;
  try { const v = JSON.parse(Buffer.from(c, 'base64url').toString()); return typeof v.at === 'string' && typeof v.id === 'string' ? v : null; } catch { return null; }
}

export interface SearchResult { data: LogEntry[]; nextCursor: string | null; matched: number; scanned: number; truncated: boolean }

export async function searchLogs(redis: RedisLike, game: string, query: LogQuery, opts: { limit?: number; cursor?: string | null } = {}): Promise<SearchResult> {
  const p = parseQuery(query.q ?? '');
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const cur = decodeCursor(opts.cursor);
  const hits: LogEntry[] = [];
  let scanned = 0;
  for await (const chunk of scan(redis, game)) {
    scanned += chunk.length;
    for (const l of chunk) if (matches(l, p, query)) hits.push(l);
  }
  hits.sort(cmp);
  const after = cur ? hits.filter((l) => l.receivedAt < cur.at || (l.receivedAt === cur.at && l.id < cur.id)) : hits;
  const page = after.slice(0, limit);
  return { data: page, nextCursor: after.length > limit ? encodeCursor(page[page.length - 1]) : null, matched: hits.length, scanned, truncated: scanned >= MAX_SCAN };
}

export type ExportFormat = 'csv' | 'json' | 'ndjson';
export const EXPORT_MIME: Record<ExportFormat, string> = { csv: 'text/csv; charset=utf-8', json: 'application/json; charset=utf-8', ndjson: 'application/x-ndjson; charset=utf-8' };

// Ekspor streaming: memori dibatasi ukuran satu potongan (500 log), bukan total hasil.
export function exportStream(redis: RedisLike, game: string, query: LogQuery, format: ExportFormat): ReadableStream<Uint8Array> {
  const p = parseQuery(query.q ?? '');
  const enc = new TextEncoder();
  const it = scan(redis, game);
  let first = true;
  let started = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (!started) {
          started = true;
          if (format === 'csv') controller.enqueue(enc.encode(`\uFEFF${csvLine(LOG_CSV_HEADERS)}`)); // tanpa CRLF penutup, sama dengan logsToCsv
          if (format === 'json') controller.enqueue(enc.encode('['));
        }
        const { done, value } = await it.next();
        if (done) {
          if (format === 'json') controller.enqueue(enc.encode(first ? ']' : '\n]'));
          controller.close();
          return;
        }
        let out = '';
        for (const l of value) {
          if (!matches(l, p, query)) continue;
          if (format === 'csv') out += `\r\n${csvLine(logCsvRow(l))}`;
          else if (format === 'ndjson') out += `${JSON.stringify(l)}\n`;
          else { out += `${first ? '\n' : ',\n'}${JSON.stringify(l)}`; }
          first = false;
        }
        if (out) controller.enqueue(enc.encode(out));
      } catch (err) {
        console.error('[export] gagal:', err instanceof Error ? err.message : err);
        controller.error(err);
      }
    },
  });
}
