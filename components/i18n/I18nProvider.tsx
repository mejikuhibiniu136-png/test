'use client';
import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, LOCALE_STORAGE_KEY, isLocale, type Locale } from '@/lib/i18n/config';
import type { Dictionary, MessageKey } from '@/lib/i18n/dictionaries/en';
import { formatDateTime, formatNumber, interpolate, type Params } from '@/lib/i18n/format';
import { loadDictionary } from '@/lib/i18n/load';

interface I18nValue {
  locale: Locale;
  t: (key: MessageKey, params?: Params) => string;
  setLocale: (next: Locale) => Promise<void>;
  n: (value: number, opts?: Intl.NumberFormatOptions) => string;
  dt: (value: Date | string | number, opts?: Intl.DateTimeFormatOptions) => string;
}

const Ctx = createContext<I18nValue | null>(null);

const readCookie = (name: string) => document.cookie.split('; ').find((c) => c.startsWith(`${name}=`))?.split('=')[1];

function persist(locale: Locale) {
  // Cookie dibaca server pada SSR berikutnya (tanpa kedip bahasa); localStorage hanya cadangan bila cookie terhapus.
  document.cookie = `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=${LOCALE_COOKIE_MAX_AGE}; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
  try { localStorage.setItem(LOCALE_STORAGE_KEY, locale); } catch { /* mode privat: abaikan */ }
  document.documentElement.lang = locale;
}

export function I18nProvider({ locale: initial, dictionary: initialDict, children }: { locale: Locale; dictionary: Dictionary; children: ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState({ locale: initial, dict: initialDict });
  const token = useRef(0);

  const setLocale = useCallback(async (next: Locale) => {
    if (!isLocale(next)) return;
    const mine = ++token.current; // klik beruntun: hanya yang terakhir yang berlaku
    const dict = await loadDictionary(next);
    if (mine !== token.current) return;
    persist(next);
    setState({ locale: next, dict });
    router.refresh(); // server component (mis. <html lang>) ikut menyesuaikan
  }, [router]);

  // Tanpa cookie tetapi ada pilihan di localStorage (cookie dihapus): pulihkan pilihan itu.
  useEffect(() => {
    if (readCookie(LOCALE_COOKIE)) return;
    try { const saved = localStorage.getItem(LOCALE_STORAGE_KEY); if (isLocale(saved) && saved !== initial) void setLocale(saved); } catch { /* abaikan */ }
  }, [initial, setLocale]);

  const value = useMemo<I18nValue>(() => ({
    locale: state.locale,
    t: (key, params) => interpolate(state.dict[key] ?? key, params),
    setLocale,
    n: (v, o) => formatNumber(state.locale, v, o),
    dt: (v, o) => formatDateTime(state.locale, v, o),
  }), [state, setLocale]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18nValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useI18n harus dipakai di dalam <I18nProvider>');
  return v;
}
export const useT = () => useI18n().t;
