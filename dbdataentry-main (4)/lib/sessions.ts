// Registri sesi server-side di atas JWT stateless.
//
//   sess:u:<user>     hash  sid -> SessionRecord        (daftar sesi aktif per pengguna)
//   sess:index        zset  user -> aktivitas terakhir   (agar Superadmin bisa menelusuri semua pengguna)
//   sess:revoked:<sid> string, TTL = sisa umur JWT       (daftar cabut / deny-list)
//
// Mengapa deny-list + registri, bukan allow-list: JWT yang diterbitkan sebelum fitur ini tidak punya
// catatan di registri; allow-list akan men-logout semua orang saat deploy. Deny-list memutus sesi
// yang dicabut dalam <= REVOKE_CACHE_MS tanpa memutus siapa pun yang tidak dicabut.
import { SESSION_MAX_AGE_SECONDS } from '@/lib/auth/jwt';
import { KEYS } from '@/lib/keys';
import { parseStored } from '@/lib/http';
import type { RedisLike } from '@/lib/redis';
import type { DeviceEntry, Role } from '@/types';

export interface SessionRecord {
  sid: string;
  username: string;
  role: Role;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  ip: string;
  os: string;
  browser: string;
  deviceType: DeviceEntry['deviceType'];
  city: string | null;
  region: string | null;
  country: string | null;
  isp: string | null;
  userAgent: string;
}

export interface SessionView extends SessionRecord { current: boolean }

export const REVOKE_CACHE_MS = 3000;
export const TOUCH_EVERY_MS = 60_000;
const SID = /^[0-9a-f-]{36}$/i;
export const isSid = (v: unknown): v is string => typeof v === 'string' && SID.test(v);
const keyOf = (username: string) => username.trim().toLowerCase();

export function recordFromDevice(username: string, role: Role, device: DeviceEntry, nowMs = Date.now()): SessionRecord {
  return {
    sid: device.sid, username, role,
    createdAt: new Date(nowMs).toISOString(), lastSeenAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + SESSION_MAX_AGE_SECONDS * 1000).toISOString(),
    ip: device.ip, os: device.os, browser: device.browser, deviceType: device.deviceType,
    city: device.city, region: device.region, country: device.country, isp: device.isp, userAgent: device.userAgent,
  };
}

export async function registerSession(redis: RedisLike, record: SessionRecord): Promise<void> {
  const key = keyOf(record.username);
  await redis.hset(KEYS.sessionsOf(key), { [record.sid]: JSON.stringify(record) });
  await redis.zadd(KEYS.sessionsIndex, { score: Date.parse(record.lastSeenAt), member: key });
}

async function readAll(redis: RedisLike, userKey: string, nowMs: number): Promise<SessionRecord[]> {
  const raw = (await redis.hgetall(KEYS.sessionsOf(userKey))) ?? {};
  const live: SessionRecord[] = [];
  const dead: string[] = [];
  for (const [sid, v] of Object.entries(raw)) {
    const rec = parseStored<SessionRecord>(v);
    if (!rec || Date.parse(rec.expiresAt) <= nowMs) dead.push(sid);
    else live.push(rec);
  }
  if (dead.length) await redis.hdel(KEYS.sessionsOf(userKey), ...dead); // JWT-nya sudah kedaluwarsa: bersihkan
  return live;
}

export async function listSessionsOf(redis: RedisLike, username: string, currentSid = '', nowMs = Date.now()): Promise<SessionView[]> {
  const rows = await readAll(redis, keyOf(username), nowMs);
  return rows.map((r) => ({ ...r, current: r.sid === currentSid })).sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
}

export async function listAllSessions(redis: RedisLike, currentSid = '', nowMs = Date.now(), maxUsers = 200): Promise<SessionView[]> {
  const users = ((await redis.zrange(KEYS.sessionsIndex, 0, maxUsers - 1, { rev: true })) ?? []).map(String);
  const all = await Promise.all(users.map((u) => listSessionsOf(redis, u, currentSid, nowMs)));
  return all.flat().sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
}

export async function revokeSession(redis: RedisLike, username: string, sid: string, nowMs = Date.now()): Promise<boolean> {
  if (!isSid(sid)) return false;
  const key = keyOf(username);
  const rec = parseStored<SessionRecord>(await redis.hget(KEYS.sessionsOf(key), sid));
  // TTL penanda = sisa umur JWT (penanda tidak perlu hidup lebih lama dari token yang diblokirnya).
  const remaining = rec ? Math.ceil((Date.parse(rec.expiresAt) - nowMs) / 1000) : SESSION_MAX_AGE_SECONDS;
  if (remaining > 0) await redis.set(KEYS.sessionRevoked(sid), '1', { ex: Math.min(remaining, SESSION_MAX_AGE_SECONDS) });
  const removed = await redis.hdel(KEYS.sessionsOf(key), sid);
  revokedCache.set(sid, { revoked: true, at: nowMs });
  return Number(removed) > 0 || rec !== null;
}

export async function revokeAllForUser(redis: RedisLike, username: string, exceptSid = '', nowMs = Date.now()): Promise<number> {
  const rows = await readAll(redis, keyOf(username), nowMs);
  let n = 0;
  for (const r of rows) {
    if (r.sid === exceptSid) continue;
    if (await revokeSession(redis, username, r.sid, nowMs)) n += 1;
  }
  return n;
}

export async function findSession(redis: RedisLike, sid: string): Promise<SessionRecord | null> {
  if (!isSid(sid)) return null;
  const users = ((await redis.zrange(KEYS.sessionsIndex, 0, 499, { rev: true })) ?? []).map(String);
  for (const u of users) {
    const rec = parseStored<SessionRecord>(await redis.hget(KEYS.sessionsOf(u), sid));
    if (rec) return rec;
  }
  return null;
}

// ---- Pemeriksaan di jalur panas (dipanggil getSession) ----
const revokedCache = new Map<string, { revoked: boolean; at: number }>();
const touchedAt = new Map<string, number>();
export const __resetSessionCaches = () => { revokedCache.clear(); touchedAt.clear(); };

export async function isSessionRevoked(redis: RedisLike, sid: string, nowMs = Date.now()): Promise<boolean> {
  if (!isSid(sid)) return false; // token lama tanpa sid yang valid: tidak bisa dicabut per sesi
  const hit = revokedCache.get(sid);
  if (hit && (hit.revoked || nowMs - hit.at < REVOKE_CACHE_MS)) return hit.revoked;
  const revoked = Number(await redis.exists(KEYS.sessionRevoked(sid))) > 0;
  if (revokedCache.size > 5000) revokedCache.clear();
  revokedCache.set(sid, { revoked, at: nowMs });
  return revoked;
}

// "Terakhir aktif" diperbarui paling sering sekali per menit per sesi per instance (hemat command Redis).
export async function touchSession(redis: RedisLike, username: string, sid: string, nowMs = Date.now()): Promise<void> {
  if (!isSid(sid) || nowMs - (touchedAt.get(sid) ?? 0) < TOUCH_EVERY_MS) return;
  touchedAt.set(sid, nowMs);
  const key = keyOf(username);
  const rec = parseStored<SessionRecord>(await redis.hget(KEYS.sessionsOf(key), sid));
  if (!rec) return; // sesi lama (sebelum registri) tidak dibuat ulang
  await redis.hset(KEYS.sessionsOf(key), { [sid]: JSON.stringify({ ...rec, lastSeenAt: new Date(nowMs).toISOString() }) });
  await redis.zadd(KEYS.sessionsIndex, { score: nowMs, member: key });
}
