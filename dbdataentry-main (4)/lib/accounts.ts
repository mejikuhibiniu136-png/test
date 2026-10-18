// Aturan akun yang dilacak (murni, tanpa I/O): dipakai server dan dashboard agar definisi
// ONLINE / STALLED / OFFLINE selalu sama.
import type { AccountPayload } from '@/schemas/account';
import type { TrackedAccount } from '@/types';

export const STALLED_AFTER_SECONDS = 30;
export const OFFLINE_AFTER_SECONDS = 45;
export const MAX_LATENCY_MS = 60_000;

// Telemetri klien: angka valid dibulatkan, selain itu dibuang (field tidak ikut disimpan).
function telemetry(value: unknown, max: number): number | undefined {
  const n = typeof value === 'number' ? value : NaN;
  return Number.isFinite(n) && n >= 0 && n <= max ? Math.round(n) : undefined;
}
const MAX_USERNAME_LENGTH = 64;
const FORBIDDEN_FIELDS = new Set(['__proto__', 'constructor', 'prototype']);

export type AccountState = 'ONLINE' | 'STALLED' | 'OFFLINE';

const isExplicitOffline = (acc: { status?: unknown } | null | undefined) =>
  String(acc?.status ?? '').toUpperCase() === 'OFFLINE';

export function getAccountState(
  acc: Pick<TrackedAccount, 'lastUpdate' | 'status'> | null | undefined,
  nowMs = Date.now()
): AccountState {
  if (!acc || isExplicitOffline(acc)) return 'OFFLINE';
  const last = new Date(acc.lastUpdate).getTime();
  if (!Number.isFinite(last)) return 'OFFLINE';
  const age = (nowMs - last) / 1000;
  if (age > OFFLINE_AFTER_SECONDS) return 'OFFLINE';
  if (age > STALLED_AFTER_SECONDS) return 'STALLED';
  return 'ONLINE';
}

// Akun yang melewati batas heartbeat ditandai OFFLINE (tanpa memutasi objek asli).
export function applyOfflineTimeout(acc: TrackedAccount, nowMs = Date.now()): TrackedAccount {
  if (isExplicitOffline(acc)) return acc;
  if (getAccountState(acc, nowMs) === 'OFFLINE') return { ...acc, status: 'OFFLINE', state: 'OFFLINE', event: 'Keluar / Timed Out' };
  return acc;
}

export function cleanText(value: unknown, max = 256): string | undefined {
  const v = typeof value === 'number' && Number.isFinite(value) ? String(value) : value;
  if (typeof v !== 'string') return undefined;
  const trimmed = v.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

export function normalizeUsername(value: unknown): string | null {
  const name = cleanText(value, MAX_USERNAME_LENGTH + 1);
  if (!name || name.length > MAX_USERNAME_LENGTH) return null;
  if (FORBIDDEN_FIELDS.has(name)) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(name)) return null;
  return name;
}

// ISO string / epoch (detik atau milidetik) -> ISO string, atau null. Lebih dari 1 hari di masa depan = tidak valid.
export function toIso(value: unknown, nowMs = Date.now()): string | null {
  if (value === undefined || value === null || value === '') return null;
  let input: string | number;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    input = value < 1e11 ? value * 1000 : value;
  } else if (typeof value === 'string') {
    input = value;
  } else {
    return null;
  }
  const ms = new Date(input).getTime();
  if (!Number.isFinite(ms) || ms > nowMs + 24 * 3600 * 1000) return null;
  return new Date(ms).toISOString();
}

// Heartbeat rutin tidak ditulis ke log (hemat command Redis, log game tidak banjir).
const HEARTBEAT_EVENTS = new Set(['heartbeat', 'aktif', 'active', 'online']);
export const isHeartbeatEvent = (event: unknown) => HEARTBEAT_EVENTS.has(String(event ?? '').trim().toLowerCase());

export interface MergeResult {
  account: TrackedAccount;
  newSession: boolean;
}

export function mergeAccount(
  existing: TrackedAccount | null,
  payload: AccountPayload,
  { nowMs = Date.now(), latencyMs = 0 }: { nowMs?: number; latencyMs?: number } = {}
): MergeResult {
  const username = normalizeUsername(payload.username) as string;
  const prev = existing;
  const nowIso = new Date(nowMs).toISOString();

  const eventName = cleanText(payload.event, 64);
  const hint = cleanText(payload.state, 32);
  const isOffline = [eventName, hint].some((v) => v && v.toLowerCase() === 'offline');

  const prevLast = prev ? new Date(prev.lastUpdate).getTime() : NaN;
  const newSession =
    !prev ||
    String(prev.status).toUpperCase() === 'OFFLINE' ||
    !Number.isFinite(prevLast) ||
    (nowMs - prevLast) / 1000 > OFFLINE_AFTER_SECONDS;

  const sessionStart = toIso(payload.sessionStart, nowMs);
  const eventTime = toIso(payload.timestamp, nowMs);
  const timestamp =
    sessionStart || (newSession ? eventTime || nowIso : toIso(prev?.timestamp, nowMs) || nowIso);

  const gameName = cleanText(payload.gameName, 128) ?? prev?.gameName ?? 'Unknown Game';
  const client = payload.latencyMs == null ? NaN : Number(payload.latencyMs);
  const finalLatency = Number.isFinite(client) && client >= 0 && client <= MAX_LATENCY_MS ? client : latencyMs;
  const state = isOffline ? 'OFFLINE' : 'ONLINE';

  return {
    newSession,
    account: {
      username,
      displayName: cleanText(payload.displayName, 64) ?? prev?.displayName ?? username,
      userId: cleanText(payload.userId, 32) ?? prev?.userId ?? '-',
      placeId: cleanText(payload.placeId, 32) ?? prev?.placeId ?? '-',
      jobId: cleanText(payload.jobId, 128) ?? prev?.jobId ?? 'Local/Private',
      gameName,
      event: eventName ?? hint ?? prev?.event ?? 'Heartbeat',
      state,
      status: state,
      avatarUrl: cleanText(payload.avatarUrl, 512) ?? prev?.avatarUrl ?? '',
      timestamp,
      sessionStart: timestamp,
      lastUpdate: nowIso,
      latencyMs: Math.max(0, Math.round(Number(finalLatency) || 0)),
      fps: telemetry(payload.fps, 1000),
      pingMs: telemetry(payload.pingMs, MAX_LATENCY_MS),
      memoryMb: telemetry(payload.memoryMb, 65_536),
      rev: (Number(prev?.rev) || 0) + 1, // nomor revisi untuk compare-and-set
    },
  };
}
