import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n/config';

// Alias kode lama / varian regional -> bahasa yang didukung.
const ALIASES: Record<string, Locale> = { in: 'id', ind: 'id', jp: 'ja', jpn: 'ja', cn: 'zh', zho: 'zh', cmn: 'zh' };

/** Memetakan satu tag BCP-47 (mis. "zh-TW", "ja-JP", "in") ke Locale yang didukung, atau null. */
export function matchTag(tag: string): Locale | null {
  const primary = tag.trim().toLowerCase().split(/[-_]/)[0];
  if (isLocale(primary)) return primary;
  return ALIASES[primary] ?? null;
}

/** Mengurai header Accept-Language menjadi tag terurut menurut bobot q (stabil untuk q yang sama). */
export function parseAcceptLanguage(header: string | null | undefined): string[] {
  if (!header) return [];
  return header.slice(0, 512).split(',')
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.map((p) => /^\s*q\s*=\s*([\d.]+)\s*$/i.exec(p)?.[1]).find(Boolean);
      const weight = q === undefined ? 1 : Number(q);
      return { tag: tag.trim(), weight: Number.isFinite(weight) ? weight : 0, index };
    })
    .filter((x) => x.tag && x.tag !== '*' && x.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.index - b.index)
    .map((x) => x.tag);
}

export function detectFromAcceptLanguage(header: string | null | undefined): Locale | null {
  for (const tag of parseAcceptLanguage(header)) { const m = matchTag(tag); if (m) return m; }
  return null;
}

/** Urutan prioritas: pilihan tersimpan (cookie) > preferensi peramban > bawaan (en). */
export function resolveLocale(input: { cookie?: string | null; acceptLanguage?: string | null }): Locale {
  if (isLocale(input.cookie)) return input.cookie;
  return detectFromAcceptLanguage(input.acceptLanguage) ?? DEFAULT_LOCALE;
}
