// Pemuat kamus per bahasa lewat import() dinamis: bundler memecahnya menjadi chunk terpisah, jadi
// klien hanya mengunduh bahasa yang dipakai (bukan keempatnya).
import type { Locale } from '@/lib/i18n/config';
import { DEFAULT_LOCALE } from '@/lib/i18n/config';
import type { Dictionary } from '@/lib/i18n/dictionaries/en';

const loaders: Record<Locale, () => Promise<Dictionary>> = {
  en: () => import('@/lib/i18n/dictionaries/en').then((m) => m.en),
  id: () => import('@/lib/i18n/dictionaries/id').then((m) => m.id),
  ja: () => import('@/lib/i18n/dictionaries/ja').then((m) => m.ja),
  zh: () => import('@/lib/i18n/dictionaries/zh').then((m) => m.zh),
};

export const loadDictionary = (locale: Locale): Promise<Dictionary> => (loaders[locale] ?? loaders[DEFAULT_LOCALE])();
