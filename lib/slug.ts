// Nama game -> slug aman untuk dipakai di nama key Redis (hanya a-z, 0-9, strip).
// Karena slug tidak pernah memuat ":" atau spasi, input pengguna tidak bisa menyusup ke key lain.

export const BUILTIN_GAMES = [{ name: 'Anime Dice', slug: 'anime-dice' }] as const;
export const FALLBACK_GAME_NAME = 'Uncategorized';
export const MAX_SLUG_LENGTH = 48;

export const isBuiltinSlug = (slug: string) => BUILTIN_GAMES.some((g) => g.slug === slug);

function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function slugify(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, '');
  // Nama tanpa karakter latin (mis. aksara lain) tetap mendapat slug yang stabil.
  return base || `g-${fnv1a(name)}`;
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/g;

// Nama tampilan bersih (di-trim, tanpa karakter kontrol, maks 64) atau null.
export function cleanGameName(value: unknown): string | null {
  const raw = typeof value === 'number' && Number.isFinite(value) ? String(value) : value;
  if (typeof raw !== 'string') return null;
  const name = raw.replace(CONTROL, '').replace(/\s+/g, ' ').trim().slice(0, 64);
  return name.length >= 2 ? name : null;
}
