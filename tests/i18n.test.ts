import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, LOCALES } from '@/lib/i18n/config';
import { detectFromAcceptLanguage, matchTag, parseAcceptLanguage, resolveLocale } from '@/lib/i18n/detect';
import { en } from '@/lib/i18n/dictionaries/en';
import { formatNumber, interpolate } from '@/lib/i18n/format';
import { loadDictionary } from '@/lib/i18n/load';

describe('i18n', () => {
  it('bahasa bawaan Inggris; empat bahasa didukung', () => {
    expect(DEFAULT_LOCALE).toBe('en');
    expect([...LOCALES]).toEqual(['en', 'id', 'ja', 'zh']);
  });

  it('Accept-Language: urut q, wildcard/q=0 diabaikan, varian regional & alias', () => {
    expect(parseAcceptLanguage('fr;q=0.4, ja;q=0.9, en;q=0.1, *;q=0.5, de;q=0')).toEqual(['ja', 'fr', 'en']);
    expect(detectFromAcceptLanguage('zh-TW,zh;q=0.9,en;q=0.8')).toBe('zh');
    expect(detectFromAcceptLanguage('in-ID,en;q=0.5')).toBe('id'); // kode lama untuk Indonesia
    expect(detectFromAcceptLanguage('fr-FR,de;q=0.8')).toBeNull();
    expect(detectFromAcceptLanguage('')).toBeNull();
    expect(matchTag('JA-jp')).toBe('ja');
  });

  it('resolveLocale: cookie sah menang; cookie palsu diabaikan; fallback ke en', () => {
    expect(resolveLocale({ cookie: 'ja', acceptLanguage: 'id' })).toBe('ja');
    expect(resolveLocale({ cookie: '<script>', acceptLanguage: 'id-ID' })).toBe('id');
    expect(resolveLocale({ cookie: 'xx', acceptLanguage: 'fr' })).toBe('en');
    expect(resolveLocale({})).toBe('en');
  });

  it('semua kamus memuat kunci yang persis sama dengan en, tanpa nilai kosong, dan placeholder yang sama', async () => {
    const keys = Object.keys(en).sort();
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
    for (const l of LOCALES) {
      const d = await loadDictionary(l);
      expect(Object.keys(d).sort(), l).toEqual(keys);
      for (const k of keys) {
        const v = (d as Record<string, string>)[k];
        expect(v.trim().length, `${l}:${k}`).toBeGreaterThan(0);
        expect(ph(v), `${l}:${k}`).toBe(ph((en as Record<string, string>)[k]));
      }
    }
  });

  it('interpolasi dan format angka per bahasa', () => {
    expect(interpolate('Hello, {name} ({n})', { name: 'A', n: 3 })).toBe('Hello, A (3)');
    expect(interpolate('Hi {x}', {})).toBe('Hi {x}');
    expect(formatNumber('id', 1234567.5)).toBe('1.234.567,5');
    expect(formatNumber('en', 1234567.5)).toBe('1,234,567.5');
  });
});
