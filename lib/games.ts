// Tabel game (namespace game:<slug>:logs) beserta metadata di games:meta.
import { envInt } from '@/lib/env';
import { HttpError, parseStored } from '@/lib/http';
import { KEYS, clearableLogKeys } from '@/lib/keys';
import { BUILTIN_GAMES, FALLBACK_GAME_NAME, cleanGameName, isBuiltinSlug, slugify } from '@/lib/slug';
import type { RedisLike } from '@/lib/redis';
import type { GameTable } from '@/types';

interface GameMeta {
  name: string;
  source: 'builtin' | 'auto' | 'manual';
  createdAt: string;
  createdBy?: string;
}

export const maxGameTables = () => envInt('MAX_GAME_TABLES', 100, 5, 1000);

export const buildMeta = (name: string, slug: string, source: GameMeta['source'], createdBy?: string, nowMs = Date.now()): GameMeta => ({
  name,
  source: isBuiltinSlug(slug) ? 'builtin' : source,
  createdAt: new Date(nowMs).toISOString(),
  ...(createdBy ? { createdBy } : {}),
});

export async function bumpSeq(redis: RedisLike): Promise<void> {
  await redis.incr(KEYS.streamSeq);
}

export async function readSeq(redis: RedisLike): Promise<number> {
  return Number(await redis.get(KEYS.streamSeq)) || 0;
}

// ---------- Baca ----------

export async function listGames(redis: RedisLike): Promise<GameTable[]> {
  let [meta, counts] = await Promise.all([redis.hgetall(KEYS.gamesMeta), redis.hgetall(KEYS.gamesCounts)]);
  meta = meta ?? {};

  // Game bawaan selalu ada, walau belum pernah menerima data.
  const missing = BUILTIN_GAMES.filter((g) => !(g.slug in meta!));
  if (missing.length) {
    await Promise.all(
      missing.map((g) => redis.hsetnx(KEYS.gamesMeta, g.slug, JSON.stringify(buildMeta(g.name, g.slug, 'builtin')))),
    );
    meta = (await redis.hgetall(KEYS.gamesMeta)) ?? meta;
  }

  const rows: GameTable[] = [];
  for (const [slug, raw] of Object.entries(meta)) {
    const m = parseStored<GameMeta>(raw);
    if (!m || typeof m.name !== 'string') continue;
    rows.push({
      slug,
      name: m.name,
      builtin: isBuiltinSlug(slug),
      source: isBuiltinSlug(slug) ? 'builtin' : m.source === 'manual' ? 'manual' : 'auto',
      createdAt: m.createdAt,
      createdBy: m.createdBy,
      total: Number(counts?.[slug]) || 0,
    });
  }
  return rows.sort((a, b) => Number(b.builtin) - Number(a.builtin) || a.name.localeCompare(b.name));
}

// ---------- Resolusi untuk ingest (auto-kategorisasi + auto-buat tabel) ----------

export interface ResolvedGame {
  slug: string;
  name: string;
  metaJson: string; // dipakai HSETNX di dalam script ingest: tabel baru dibuat atomik bersama log pertamanya
  isNew: boolean;
}

const CACHE_MS = 10_000;
const resolveCache = new Map<string, { value: ResolvedGame; exp: number }>();
export const __clearResolveCache = () => resolveCache.clear();

export async function resolveGame(redis: RedisLike, rawName: unknown, nowMs = Date.now()): Promise<ResolvedGame> {
  const wanted = cleanGameName(rawName) ?? FALLBACK_GAME_NAME;
  let slug = slugify(wanted);

  const hit = resolveCache.get(slug);
  if (hit && hit.exp > nowMs) return { ...hit.value, isNew: false };

  // Tabel yang sudah diganti namanya: nama lama diarahkan ke slug baru.
  const alias = await redis.hget(KEYS.gamesAlias, slug);
  let name = wanted;
  if (typeof alias === 'string' && alias) slug = alias;

  const existing = parseStored<GameMeta>(await redis.hget(KEYS.gamesMeta, slug));
  let isNew = false;
  if (existing && typeof existing.name === 'string') {
    name = existing.name;
  } else if (!isBuiltinSlug(slug) && (await redis.hlen(KEYS.gamesMeta)) >= maxGameTables()) {
    // Batas jumlah tabel: sumber baru berikutnya masuk ke tabel cadangan, bukan membuat tabel tanpa batas.
    name = FALLBACK_GAME_NAME;
    slug = slugify(FALLBACK_GAME_NAME);
    isNew = !(await redis.hexists(KEYS.gamesMeta, slug));
  } else {
    isNew = true;
    name = BUILTIN_GAMES.find((g) => g.slug === slug)?.name ?? name;
  }

  const value: ResolvedGame = { slug, name, metaJson: JSON.stringify(buildMeta(name, slug, 'auto')), isNew };
  resolveCache.set(slugify(wanted), { value, exp: nowMs + CACHE_MS });
  return value;
}

// ---------- Kelola manual (admin) ----------

export async function createGame(redis: RedisLike, rawName: string, by: string): Promise<GameTable> {
  const name = cleanGameName(rawName);
  if (!name) throw new HttpError(400, 'Nama tabel tidak valid');
  const slug = slugify(name);
  if (isBuiltinSlug(slug)) throw new HttpError(409, 'Tabel bawaan sudah ada');

  if ((await redis.hlen(KEYS.gamesMeta)) >= maxGameTables()) {
    throw new HttpError(409, `Jumlah tabel sudah mencapai batas (${maxGameTables()})`);
  }
  const created = await redis.hsetnx(KEYS.gamesMeta, slug, JSON.stringify(buildMeta(name, slug, 'manual', by)));
  if (!created) throw new HttpError(409, 'Tabel dengan nama itu sudah ada');
  await redis.hdel(KEYS.gamesAlias, slug); // nama yang pernah dipindahkan boleh dipakai lagi
  __clearResolveCache();
  await bumpSeq(redis);
  return { slug, name, builtin: isBuiltinSlug(slug), source: 'manual', createdAt: new Date().toISOString(), createdBy: by, total: 0 };
}

export async function renameGame(redis: RedisLike, slug: string, rawName: string): Promise<GameTable> {
  const name = cleanGameName(rawName);
  if (!name) throw new HttpError(400, 'Nama tabel tidak valid');
  if (isBuiltinSlug(slug)) throw new HttpError(400, 'Tabel bawaan tidak bisa diubah namanya');

  const meta = parseStored<GameMeta>(await redis.hget(KEYS.gamesMeta, slug));
  if (!meta) throw new HttpError(404, 'Tabel tidak ditemukan');
  const nextSlug = slugify(name);

  if (nextSlug === slug) {
    // Hanya tampilan nama yang berubah (huruf besar/kecil, spasi): key tidak berpindah.
    const updated = { ...meta, name };
    await redis.hset(KEYS.gamesMeta, { [slug]: JSON.stringify(updated) });
    await bumpSeq(redis);
    return { slug, name, builtin: false, source: meta.source === 'manual' ? 'manual' : 'auto', createdAt: meta.createdAt, createdBy: meta.createdBy, total: Number(await redis.hget(KEYS.gamesCounts, slug)) || 0 };
  }

  if (isBuiltinSlug(nextSlug) || (await redis.hexists(KEYS.gamesMeta, nextSlug))) {
    throw new HttpError(409, 'Tabel dengan nama itu sudah ada');
  }

  // Pindahkan data log: RENAME hanya berhasil bila key sumber ada; tabel kosong tidak punya key.
  if (await redis.exists(KEYS.gameLogs(slug))) {
    await redis.del(KEYS.gameLogs(nextSlug));
    await redis.rename(KEYS.gameLogs(slug), KEYS.gameLogs(nextSlug));
  }
  const total = Number(await redis.hget(KEYS.gamesCounts, slug)) || 0;
  const updated: GameMeta = { ...meta, name };
  await redis.hset(KEYS.gamesMeta, { [nextSlug]: JSON.stringify(updated) });
  if (total) await redis.hset(KEYS.gamesCounts, { [nextSlug]: String(total) });
  await redis.hdel(KEYS.gamesMeta, slug);
  await redis.hdel(KEYS.gamesCounts, slug);

  // Alias lama (termasuk yang menunjuk ke slug ini) diarahkan ke slug baru.
  const aliases = (await redis.hgetall(KEYS.gamesAlias)) ?? {};
  const repoint: Record<string, string> = { [slug]: nextSlug };
  for (const [from, to] of Object.entries(aliases)) if (to === slug) repoint[from] = nextSlug;
  await redis.hset(KEYS.gamesAlias, repoint);
  await redis.hdel(KEYS.gamesAlias, nextSlug);

  __clearResolveCache();
  await bumpSeq(redis);
  return { slug: nextSlug, name, builtin: false, source: meta.source === 'manual' ? 'manual' : 'auto', createdAt: meta.createdAt, createdBy: meta.createdBy, total };
}

export async function deleteGame(redis: RedisLike, slug: string): Promise<void> {
  if (isBuiltinSlug(slug)) throw new HttpError(400, 'Tabel bawaan tidak bisa dihapus');
  if (!(await redis.hexists(KEYS.gamesMeta, slug))) throw new HttpError(404, 'Tabel tidak ditemukan');

  const aliases = (await redis.hgetall(KEYS.gamesAlias)) ?? {};
  const stale = Object.entries(aliases).filter(([from, to]) => to === slug || from === slug).map(([from]) => from);

  await redis.del(KEYS.gameLogs(slug));
  await redis.hdel(KEYS.gamesMeta, slug);
  await redis.hdel(KEYS.gamesCounts, slug);
  if (stale.length) await redis.hdel(KEYS.gamesAlias, ...stale);
  __clearResolveCache();
  await bumpSeq(redis);
}

// ---------- Clear Logs ----------

// HANYA menghapus key log (logs:stream dan/atau game:<slug>:logs). users:* tidak pernah masuk
// daftar key, lihat clearableLogKeys. Metadata tabel dan akun tracker juga tidak disentuh.
export async function clearLogs(redis: RedisLike, scope: 'all' | { game: string }): Promise<number> {
  let keys: string[];
  if (scope === 'all') {
    const slugs = Object.keys((await redis.hgetall(KEYS.gamesMeta)) ?? {});
    keys = clearableLogKeys(slugs, 'all');
  } else {
    if (!(await redis.hexists(KEYS.gamesMeta, scope.game))) throw new HttpError(404, 'Tabel tidak ditemukan');
    keys = clearableLogKeys([], { game: scope.game });
  }
  const removed = await redis.del(...keys);
  await bumpSeq(redis);
  return Number(removed) || 0;
}
