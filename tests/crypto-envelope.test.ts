// Multi-layer envelope encryption: sifat kriptografis yang dijanjikan, diuji langsung.
import { createCipheriv, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CryptoError, classify, envelopeKid, isEnvelope, loadKeyring, openJson, openString, rewrap, sealJson, sealString, tryOpenAny } from '@/lib/security/crypto';

const A = 'a1'.repeat(32);
const B = 'b2'.repeat(32);
const ringOf = (active: string, ...old: string[]) => loadKeyring({ ENCRYPTION_KEY: active, ENCRYPTION_KEYS_RETIRED: old.join(',') });

describe('envelope encryption', () => {
  it('round-trip string dan JSON; setiap segel unik (DEK + IV acak)', () => {
    const ring = ringOf(A);
    const s1 = sealString('rahasia', 'ctx:a', ring);
    const s2 = sealString('rahasia', 'ctx:a', ring);
    expect(isEnvelope(s1)).toBe(true);
    expect(s1).not.toBe(s2);
    expect(openString(s1, 'ctx:a', ring)).toBe('rahasia');
    expect(openJson<{ n: number }>(sealJson({ n: 7 }, 'ctx:j', ring), 'ctx:j', ring)).toEqual({ n: 7 });
  });

  it('payload kosong dan Unicode (ja/zh/emoji) aman', () => {
    const ring = ringOf(A);
    for (const v of ['', '日本語テキスト', '中文内容 🔐']) expect(openString(sealString(v, 'c', ring), 'c', ring)).toBe(v);
  });

  it('segmen apa pun yang diubah ditolak (HMAC), termasuk ciphertext, header, dan MAC', () => {
    const ring = ringOf(A);
    const sealed = sealString('data-penting', 'ctx', ring);
    const parts = sealed.split('.');
    for (let i = 2; i < parts.length; i += 1) {
      const t = [...parts];
      const seg = Buffer.from(t[i] || 'AA', 'base64url');
      seg[0] ^= 1;
      t[i] = seg.toString('base64url');
      expect(() => openString(t.join('.'), 'ctx', ring), `segmen ${i}`).toThrow(CryptoError);
    }
  });

  it('konteks berbeda ditolak: ciphertext tidak bisa dipindah antar field', () => {
    const ring = ringOf(A);
    const sealed = sealString('token', 'settings:WEBHOOK_SECRET', ring);
    expect(() => openString(sealed, 'settings:API_KEY', ring)).toThrowError(expect.objectContaining({ code: 'integrity' }));
  });

  it('KEK salah / tidak dikenal: unknown_kid, bukan crash', () => {
    const sealed = sealString('x', 'c', ringOf(A));
    expect(() => openString(sealed, 'c', ringOf(B))).toThrowError(expect.objectContaining({ code: 'unknown_kid' }));
  });

  it('tanpa ENCRYPTION_KEY aktif, penyegelan melempar ConfigError', () => {
    expect(() => sealString('x', 'c', loadKeyring({}))).toThrow(/ENCRYPTION_KEY/);
  });

  it('rewrap: KEK baru bisa membuka, payload (ciphertext) identik, KEK lama boleh dibuang', () => {
    const old = ringOf(A);
    const sealed = sealString('rotasi-aman', 'c', old);
    const both = ringOf(B, A); // B aktif, A parkir
    const moved = rewrap(sealed, 'c', both);
    expect(moved).not.toBe(sealed);
    expect(envelopeKid(moved)).toBe(both.active!.kid);
    expect(moved.split('.')[5]).toBe(sealed.split('.')[5]); // ct tidak disentuh
    expect(openString(moved, 'c', ringOf(B))).toBe('rotasi-aman'); // A sudah dibuang
    expect(rewrap(moved, 'c', ringOf(B))).toBe(moved); // idempoten
  });

  it('classify: current / stale / legacy / broken', () => {
    const sealed = sealString('v', 'c', ringOf(A));
    expect(classify(sealed, 'c', ringOf(A)).state).toBe('current');
    expect(classify(sealed, 'c', ringOf(B, A))).toMatchObject({ state: 'stale', plain: 'v' });
    expect(classify(sealed, 'c', ringOf(B)).state).toBe('broken');
    expect(classify('sampah', 'c', ringOf(A)).state).toBe('broken');

    // format lama iv:tag:data (AES-256-GCM langsung dengan kunci mentah)
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', Buffer.from(A, 'hex'), iv);
    const enc = Buffer.concat([cipher.update('lama', 'utf8'), cipher.final()]);
    const legacy = `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${enc.toString('hex')}`;
    expect(classify(legacy, 'c', ringOf(A))).toMatchObject({ state: 'legacy', plain: 'lama' });
    expect(tryOpenAny(legacy, 'c', ringOf(B, A))).toBe('lama');
  });

  it('kid deterministik dan tidak memuat kunci', () => {
    const k = ringOf(A).active!;
    expect(k.kid).toBe(ringOf(A).active!.kid);
    expect(k.kid).not.toBe(ringOf(B).active!.kid);
    expect(A).not.toContain(k.kid);
  });
});
