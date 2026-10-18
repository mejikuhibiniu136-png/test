import { LOCALE_NAMES, type Locale } from '@/lib/i18n/config';

export type Params = Record<string, string | number>;

/** Interpolasi "{nama}". Placeholder tak dikenal dibiarkan apa adanya agar kesalahan terlihat. */
export const interpolate = (template: string, params?: Params): string =>
  params ? template.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m)) : template;

export const formatNumber = (locale: Locale, n: number, opts?: Intl.NumberFormatOptions) => new Intl.NumberFormat(LOCALE_NAMES[locale].intl, opts).format(n);
export const formatDateTime = (locale: Locale, d: Date | string | number, opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' }) =>
  new Intl.DateTimeFormat(LOCALE_NAMES[locale].intl, opts).format(new Date(d));
export const formatRelative = (locale: Locale, deltaSeconds: number): string => {
  const rtf = new Intl.RelativeTimeFormat(LOCALE_NAMES[locale].intl, { numeric: 'auto' });
  const abs = Math.abs(deltaSeconds);
  if (abs < 60) return rtf.format(Math.round(deltaSeconds), 'second');
  if (abs < 3600) return rtf.format(Math.round(deltaSeconds / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(deltaSeconds / 3600), 'hour');
  return rtf.format(Math.round(deltaSeconds / 86400), 'day');
};
