import { describe, expect, it } from 'vitest';
import { buildSelfDecryptingLua, isBrowserNavigation } from '@/lib/lua/protect';
import { SCRIPT_MAGIC, openScript, sealScript } from '@/lib/lua/scriptCrypto';

describe('scriptCrypto', () => {
  it('round-trip dengan key yang benar, gagal dengan key salah', () => {
    const { nonce, hex } = sealScript('print("halo ✓")', 'k1');
    expect(openScript(hex, 'k1', nonce)).toBe(SCRIPT_MAGIC + 'print("halo ✓")');
    expect(openScript(hex, 'k2', nonce).startsWith(SCRIPT_MAGIC)).toBe(false);
  });
});

describe('protect', () => {
  it('stub tidak memuat teks skrip asli dan berubah tiap request', () => {
    const a = buildSelfDecryptingLua('local SECRET_URL = "https://x.test/api"');
    expect(a).not.toContain('SECRET_URL');
    expect(a).not.toContain('x.test');
    expect(buildSelfDecryptingLua('same')).not.toBe(buildSelfDecryptingLua('same'));
  });
  it('mengenali navigasi browser, bukan eksekutor', () => {
    expect(isBrowserNavigation(new Headers({ 'sec-fetch-mode': 'navigate' }))).toBe(true);
    expect(isBrowserNavigation(new Headers({ accept: 'text/html,application/xhtml+xml' }))).toBe(true);
    expect(isBrowserNavigation(new Headers({ 'user-agent': 'Roblox/WinInet' }))).toBe(false);
  });
});
