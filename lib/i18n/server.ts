import { cookies, headers } from 'next/headers';
import { cache } from 'react';
import { LOCALE_COOKIE, type Locale } from '@/lib/i18n/config';
import { resolveLocale } from '@/lib/i18n/detect';
import { loadDictionary } from '@/lib/i18n/load';

// Satu kali per request (React cache): cookie > Accept-Language > en.
export const getLocale = cache(async (): Promise<Locale> => {
  const [c, h] = await Promise.all([cookies(), headers()]);
  return resolveLocale({ cookie: c.get(LOCALE_COOKIE)?.value, acceptLanguage: h.get('accept-language') });
});

export const getDictionary = cache(async () => loadDictionary(await getLocale()));
