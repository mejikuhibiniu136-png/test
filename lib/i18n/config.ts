// Konfigurasi i18n tanpa pustaka eksternal. Bahasa bawaan: Inggris.
export const LOCALES = ['en', 'id', 'ja', 'zh'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';
export const LOCALE_COOKIE = 'dbde_lang';
export const LOCALE_STORAGE_KEY = 'dbde_lang';
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

// Nama asli bahasa (endonym) tidak diterjemahkan: pengguna harus bisa menemukan bahasanya sendiri.
export const LOCALE_NAMES: Readonly<Record<Locale, { native: string; short: string; intl: string }>> = {
  en: { native: 'English', short: 'EN', intl: 'en-US' },
  id: { native: 'Bahasa Indonesia', short: 'ID', intl: 'id-ID' },
  ja: { native: '日本語', short: 'JA', intl: 'ja-JP' },
  zh: { native: '简体中文', short: 'ZH', intl: 'zh-CN' },
};

export const isLocale = (v: unknown): v is Locale => typeof v === 'string' && (LOCALES as readonly string[]).includes(v);
