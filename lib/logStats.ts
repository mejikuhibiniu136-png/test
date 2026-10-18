// Fungsi murni untuk dashboard (tanpa React/Redis).
import type { GameTable, LogEntry, TrackedAccount } from '@/types';

export const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export const isHeartbeat = (log: LogEntry) => ['heartbeat', 'aktif'].includes(str(log.payload?.event).toLowerCase());
export const hasEmbeds = (log: LogEntry) => Array.isArray(log.payload?.embeds) && log.payload.embeds.length > 0;

export function userOfLog(log: LogEntry): string {
  const p = log.payload ?? {};
  return str(p.content).replace(/\|\|/g, '').replace('Username: ', '').trim() || str(p.username) || '';
}

export const eventLabel = (log: LogEntry) => str(log.payload?.event) || str(log.eventType) || 'Event';

const RARITY: Record<string, number> = {
  '': 1, k: 1e3, m: 1e6, b: 1e9, t: 1e12, qd: 1e15, qi: 1e18, sx: 1e21, sp: 1e24, oc: 1e27,
  no: 1e30, dc: 1e33, udc: 1e36, ddc: 1e39, tdc: 1e42, qdc: 1e45, qidc: 1e48, sxdc: 1e51,
  spdc: 1e54, ocdc: 1e57, nodc: 1e60, vg: 1e63, googol: 1e100,
};

export function parseRarityChance(text: string): number {
  const m = text?.match(/1\/([\d.]+)([a-zA-Z]*)/i);
  if (!m) return 0;
  const score = parseFloat(m[1]) * (RARITY[m[2].toLowerCase().replace('!', '')] ?? 1);
  return Number.isFinite(score) ? score : 0;
}

export interface Ranked { name: string; count: number }
const top = (map: Record<string, number>, n?: number): Ranked[] => {
  const rows = Object.entries(map).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name, count]) => ({ name, count }));
  return n ? rows.slice(0, n) : rows;
};

export function computeLogStats(logs: LogEntry[]) {
  let maxFloor = 0, totalUnits = 0, highestRarity = '-', maxScore = 0, sum = 0, cnt = 0, maxMs = 0;
  const loot: Record<string, number> = Object.create(null);
  const users: Record<string, number> = Object.create(null);
  const events: Record<string, number> = Object.create(null);

  for (const log of logs) {
    try {
      const p = log.payload ?? {};
      const desc = str(p.embeds?.[0]?.description).replace(/\*\*/g, '');
      const title = str(p.embeds?.[0]?.title);
      const user = userOfLog(log);
      const pm = Number(log.processingTimeMs);
      if (Number.isFinite(pm) && pm >= 0) { sum += pm; cnt += 1; if (pm > maxMs) maxMs = pm; }
      const label = eventLabel(log);
      events[label] = (events[label] || 0) + 1;
      if (user && !isHeartbeat(log)) users[user] = (users[user] || 0) + 1;

      const floor = desc.match(/Floor Reached:\s*(\d+)/i);
      if (floor) maxFloor = Math.max(maxFloor, parseInt(floor[1], 10));
      for (const line of desc.split('\n')) {
        const m = line.match(/^\s*([A-Za-z0-9\s]+):\s*x?(\d+)/);
        if (m && !['Floor Reached', 'Name', 'Drops'].includes(m[1].trim())) {
          loot[m[1].trim()] = (loot[m[1].trim()] || 0) + parseInt(m[2], 10);
        }
      }
      if (title.includes('New Unit!')) {
        totalUnits += 1;
        const c = title.match(/New Unit!\s*(1\/[^\s!]+)/i);
        if (c) {
          const score = parseRarityChance(c[1]);
          if (score > maxScore) { maxScore = score; highestRarity = c[1]; }
        }
      }
    } catch (err) {
      console.error('Log dilewati saat menghitung statistik:', err);
    }
  }
  const topUsers = top(users, 8);
  return {
    maxFloor, totalUnits, highestRarity, topLoot: top(loot, 12), topUsers, topEvents: top(events, 8),
    uniqueUsers: Array.from(new Set(logs.map((l) => l.payload?.username).filter((u): u is string => typeof u === 'string' && !!u))).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())),
    heartbeatCount: logs.filter(isHeartbeat).length,
    avgProcessingMs: cnt ? Math.round(sum / cnt) : 0,
    maxProcessingMs: maxMs,
  };
}

export const RANGE_OPTIONS = [
  { id: 'ALL', label: 'Semua waktu', ms: 0 },
  { id: '5M', label: '5 menit', ms: 5 * 60_000 },
  { id: '1H', label: '1 jam', ms: 3_600_000 },
  { id: '24H', label: '24 jam', ms: 86_400_000 },
];

const searchCache = new WeakMap<LogEntry, string>();
function searchText(log: LogEntry): string {
  let t = searchCache.get(log);
  if (t === undefined) {
    let body = '';
    try { body = JSON.stringify(log.payload ?? {}); } catch { body = ''; }
    t = `${str(log.eventType)} ${body}`.toLowerCase();
    searchCache.set(log, t);
  }
  return t;
}

export interface LogFilter { search: string; user: string; hideHeartbeat: boolean; rangeId: string }

export function filterLogs(logs: LogEntry[], f: LogFilter, nowMs = Date.now()): LogEntry[] {
  const q = f.search.trim().toLowerCase();
  const rangeMs = RANGE_OPTIONS.find((r) => r.id === f.rangeId)?.ms ?? 0;
  return logs.filter((log) => {
    if (q && !searchText(log).includes(q)) return false;
    if (f.user !== 'ALL' && log.payload?.username !== f.user) return false;
    if (f.hideHeartbeat && isHeartbeat(log)) return false;
    if (rangeMs) {
      const t = new Date(log.receivedAt).getTime();
      if (!Number.isFinite(t) || nowMs - t > rangeMs) return false;
    }
    return true;
  });
}

export interface Activity { buckets: { start: number; heartbeat: number; other: number }[]; spanMs: number; bucketMs: number; max: number }

export function buildActivity(logs: LogEntry[], nowMs = Date.now(), n = 24): Activity {
  const times = logs.map((l) => new Date(l.receivedAt).getTime()).filter((t) => Number.isFinite(t) && t <= nowMs + 60_000);
  if (!times.length) return { buckets: [], spanMs: 0, bucketMs: 0, max: 0 };
  const spanMs = Math.min(Math.max(nowMs - Math.min(...times), 5 * 60_000), 86_400_000);
  const bucketMs = Math.ceil(spanMs / n);
  const start = nowMs - bucketMs * n;
  const out = Array.from({ length: n }, (_, i) => ({ start: start + i * bucketMs, heartbeat: 0, other: 0 }));
  for (const log of logs) {
    const t = new Date(log.receivedAt).getTime();
    if (!Number.isFinite(t) || t < start || t > nowMs + bucketMs) continue;
    const i = Math.min(n - 1, Math.max(0, Math.floor((t - start) / bucketMs)));
    if (isHeartbeat(log)) out[i].heartbeat += 1; else out[i].other += 1;
  }
  return { buckets: out, spanMs, bucketMs, max: out.reduce((m, b) => Math.max(m, b.heartbeat + b.other), 0) };
}

export function latencySeries(logs: LogEntry[], username: string, max = 24): number[] {
  const v: number[] = [];
  for (const log of logs) {
    if (log.payload?.username !== username) continue;
    const x = Number(log.processingTimeMs);
    if (Number.isFinite(x) && x >= 0) v.push(x);
    if (v.length >= max) break;
  }
  return v.reverse();
}

export function formatDuration(totalSeconds: number): string {
  const d = Math.floor(totalSeconds);
  if (!Number.isFinite(d) || d <= 0) return '0s';
  const h = Math.floor(d / 3600), m = Math.floor((d % 3600) / 60), s = d % 60;
  return h > 0 ? `${h}j ${m}m ${s}s` : m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export function timeAgo(thenMs: number, nowMs = Date.now()): string {
  if (!Number.isFinite(thenMs)) return '-';
  const s = Math.max(0, Math.floor((nowMs - thenMs) / 1000));
  if (s < 5) return 'baru saja';
  if (s < 60) return `${s} dtk lalu`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} mnt lalu`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} jam lalu` : `${Math.floor(h / 24)} hari lalu`;
}

export const formatNumber = (n: unknown) => (Number.isFinite(Number(n)) ? Number(n).toLocaleString('id-ID') : '-');

// Sel CSV dinetralkan dari injeksi rumus spreadsheet (=, +, -, @).
export function csvCell(value: unknown): string {
  let t = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return `"${t.replace(/"/g, '""')}"`;
}
export const csvLine = (cells: unknown[]) => cells.map(csvCell).join(',');
const toCsv = (headers: string[], rows: unknown[][]) =>
  `\uFEFF${[headers.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\r\n')}`;

export const LOG_CSV_HEADERS = ['receivedAt', 'game', 'eventType', 'username', 'event', 'format', 'bytes', 'processingTimeMs', 'payload'];

export function logCsvRow(l: LogEntry): unknown[] {
  let payload = '';
  try { payload = JSON.stringify(l.payload); } catch { payload = ''; }
  return [l.receivedAt, l.gameName, l.eventType, l.payload?.username, l.payload?.event, l.format, l.bytes, l.processingTimeMs, payload];
}

export const logsToCsv = (logs: LogEntry[]) => toCsv(LOG_CSV_HEADERS, logs.map(logCsvRow));

export const accountsToCsv = (accounts: TrackedAccount[], stateOf: (a: TrackedAccount) => string) =>
  toCsv(
    ['username', 'displayName', 'state', 'gameName', 'userId', 'placeId', 'jobId', 'event', 'latencyMs', 'fps', 'pingMs', 'memoryMb', 'sessionStart', 'lastUpdate'],
    accounts.map((a) => [a.username, a.displayName, stateOf(a), a.gameName, a.userId, a.placeId, a.jobId, a.event, a.latencyMs, a.fps ?? '', a.pingMs ?? '', a.memoryMb ?? '', a.timestamp, a.lastUpdate])
  );

export const gamesToCsv = (games: GameTable[]) =>
  toCsv(
    ['slug', 'name', 'source', 'builtin', 'createdAt', 'createdBy', 'total'],
    games.map((g) => [g.slug, g.name, g.source, g.builtin, g.createdAt, g.createdBy ?? '', g.total])
  );
