// Multi-Layer Envelope Encryption.
//
//   Layer 1  payload  --AES-256-GCM(DEK acak per transaksi)-->  ciphertext
//   Layer 2  DEK      --ChaCha20-Poly1305(wrapKey turunan KEK)-->  wrapped DEK
//   Integrity          HMAC-SHA256(macKey turunan KEK) atas seluruh header + ciphertext
//
// Format (semua segmen base64url, dipisah titik):
//   dbde2.<kid>.<wrapNonce>.<wrappedDek+tag>.<iv>.<ciphertext+tag>.<mac>
//
// Konteks (mis. "settings:WEBHOOK_SECRET") tidak disimpan di amplop; ia dimasukkan sebagai AAD ke
// kedua AEAD dan ke HMAC. Akibatnya ciphertext tidak bisa dipindah dari satu field ke field lain
// (serangan relokasi ciphertext) walaupun penyerang bisa menulis ke Redis.
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { loadKeyring, requireActiveKek, type Kek, type Keyring } from '@/lib/security/crypto/keyring';

export type CryptoErrorCode = 'format' | 'unknown_kid' | 'integrity' | 'decrypt' | 'no_key';

export class CryptoError extends Error {
  readonly code: CryptoErrorCode;
  constructor(code: CryptoErrorCode, message: string) {
    super(message);
    this.name = 'CryptoError';
    this.code = code;
  }
}

const PREFIX = 'dbde2';
const NONCE = 12;
const TAG = 16;
const DEK_BYTES = 32;
const ENVELOPE_RE = /^dbde2\.[A-Za-z0-9_-]{8,16}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]{43}$/;
const LEGACY_RE = /^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/i;

const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64url');
const unb64 = (s: string) => Buffer.from(s, 'base64url');
// AAD payload sengaja TIDAK memuat kid: kid berubah saat re-wrap, sedangkan ciphertext payload tidak
// boleh disentuh. kid tetap terlindungi oleh HMAC dan oleh AAD key-wrap.
const aadData = (ctx: string, iv: string) => Buffer.from(`${PREFIX}|data|${ctx}|${iv}`, 'utf8');
const aadWrap = (kid: string, ctx: string, iv: string) => Buffer.from(`${PREFIX}|wrap|${kid}|${ctx}|${iv}`, 'utf8');
const macInput = (head: string, ctx: string) => Buffer.from(`${head}\0${ctx}`, 'utf8');
const mac = (kek: Kek, head: string, ctx: string) => createHmac('sha256', kek.macKey).update(macInput(head, ctx)).digest();

export const isEnvelope = (v: unknown): v is string => typeof v === 'string' && ENVELOPE_RE.test(v);
export const isLegacyCiphertext = (v: unknown): v is string => typeof v === 'string' && LEGACY_RE.test(v);

function aeadSeal(algo: 'aes-256-gcm' | 'chacha20-poly1305', key: Buffer, nonce: Buffer, aad: Buffer, plain: Buffer): Buffer {
  // Overload Node membedakan GCM dan ChaCha20; keduanya berbagi API AEAD yang sama saat runtime.
  const c = createCipheriv(algo as 'aes-256-gcm', key, nonce, { authTagLength: TAG });
  c.setAAD(aad);
  return Buffer.concat([c.update(plain), c.final(), c.getAuthTag()]);
}

function aeadOpen(algo: 'aes-256-gcm' | 'chacha20-poly1305', key: Buffer, nonce: Buffer, aad: Buffer, sealed: Buffer): Buffer {
  if (sealed.length < TAG) throw new CryptoError('format', 'Segmen terlalu pendek');
  const d = createDecipheriv(algo as 'aes-256-gcm', key, nonce, { authTagLength: TAG });
  d.setAAD(aad);
  d.setAuthTag(sealed.subarray(sealed.length - TAG));
  try {
    return Buffer.concat([d.update(sealed.subarray(0, sealed.length - TAG)), d.final()]);
  } catch {
    throw new CryptoError('decrypt', 'Autentikasi AEAD gagal');
  }
}

function build(kek: Kek, ctx: string, wrapNonce: Buffer, wrappedDek: Buffer, iv: Buffer, ct: Buffer): string {
  const head = [PREFIX, kek.kid, b64(wrapNonce), b64(wrappedDek), b64(iv), b64(ct)].join('.');
  return `${head}.${b64(mac(kek, head, ctx))}`;
}

export function sealBytes(plain: Uint8Array, context: string, ring: Keyring = loadKeyring()): string {
  const kek = requireActiveKek(ring);
  const dek = randomBytes(DEK_BYTES); // DEK baru untuk SETIAP transaksi
  const iv = randomBytes(NONCE);
  const wrapNonce = randomBytes(NONCE);
  try {
    const ct = aeadSeal('aes-256-gcm', dek, iv, aadData(context, b64(iv)), Buffer.from(plain));
    const wrapped = aeadSeal('chacha20-poly1305', kek.wrapKey, wrapNonce, aadWrap(kek.kid, context, b64(iv)), dek);
    return build(kek, context, wrapNonce, wrapped, iv, ct);
  } finally {
    dek.fill(0);
  }
}

interface Parsed { kid: string; wrapNonce: Buffer; wrapped: Buffer; iv: Buffer; ct: Buffer; head: string; mac: Buffer }

function parse(sealed: string): Parsed {
  if (!isEnvelope(sealed)) throw new CryptoError('format', 'Format amplop tidak dikenal');
  const [, kid, wn, wd, iv, ct, m] = sealed.split('.');
  const head = sealed.slice(0, sealed.lastIndexOf('.'));
  const p = { kid, wrapNonce: unb64(wn), wrapped: unb64(wd), iv: unb64(iv), ct: unb64(ct), head, mac: unb64(m) };
  if (p.wrapNonce.length !== NONCE || p.iv.length !== NONCE || p.wrapped.length !== DEK_BYTES + TAG || p.mac.length !== 32) {
    throw new CryptoError('format', 'Panjang segmen amplop tidak valid');
  }
  return p;
}

// HMAC diverifikasi LEBIH DULU (encrypt-then-MAC) dengan perbandingan waktu-konstan: amplop yang
// dirusak ditolak sebelum satu pun operasi dekripsi dijalankan dan tanpa membedakan penyebabnya.
function verify(p: Parsed, ctx: string, ring: Keyring): Kek {
  const kek = ring.byKid.get(p.kid);
  if (!kek) throw new CryptoError('unknown_kid', 'KEK untuk amplop ini tidak tersedia');
  const expected = mac(kek, p.head, ctx);
  if (expected.length !== p.mac.length || !timingSafeEqual(expected, p.mac)) throw new CryptoError('integrity', 'HMAC tidak cocok: data berubah atau konteks salah');
  return kek;
}

function unwrapDek(p: Parsed, kek: Kek, ctx: string): Buffer {
  return aeadOpen('chacha20-poly1305', kek.wrapKey, p.wrapNonce, aadWrap(kek.kid, ctx, b64(p.iv)), p.wrapped);
}

export function openBytes(sealed: string, context: string, ring: Keyring = loadKeyring()): Buffer {
  const p = parse(sealed);
  const kek = verify(p, context, ring);
  const dek = unwrapDek(p, kek, context);
  try {
    return aeadOpen('aes-256-gcm', dek, p.iv, aadData(context, b64(p.iv)), p.ct);
  } finally {
    dek.fill(0);
  }
}

export const sealString = (plain: string, context: string, ring?: Keyring) => sealBytes(Buffer.from(plain, 'utf8'), context, ring);
export const openString = (sealed: string, context: string, ring?: Keyring) => openBytes(sealed, context, ring).toString('utf8');
export const sealJson = (value: unknown, context: string, ring?: Keyring) => sealString(JSON.stringify(value), context, ring);
export const openJson = <T>(sealed: string, context: string, ring?: Keyring): T => JSON.parse(openString(sealed, context, ring)) as T;

/**
 * Rotasi KEK murah: hanya DEK (48 byte) yang dibungkus ulang dengan KEK aktif. Ciphertext payload
 * TIDAK disentuh dan tidak didekripsi, sehingga biayanya O(1) per rekaman berapa pun ukurannya.
 */
export function rewrap(sealed: string, context: string, ring: Keyring = loadKeyring()): string {
  const active = requireActiveKek(ring);
  const p = parse(sealed);
  const old = verify(p, context, ring);
  if (old.kid === active.kid) return sealed;
  const dek = unwrapDek(p, old, context);
  try {
    const wrapNonce = randomBytes(NONCE);
    const wrapped = aeadSeal('chacha20-poly1305', active.wrapKey, wrapNonce, aadWrap(active.kid, context, b64(p.iv)), dek);
    return build(active, context, wrapNonce, wrapped, p.iv, p.ct);
  } finally {
    dek.fill(0);
  }
}

export function envelopeKid(sealed: string): string | null {
  return isEnvelope(sealed) ? sealed.split('.')[1] : null;
}

function openLegacy(value: string, ring: Keyring): { plain: string; kek: Kek } | null {
  const [iv, tag, data] = value.split(':');
  for (const kek of ring.ordered) {
    try {
      const d = createDecipheriv('aes-256-gcm', kek.raw, Buffer.from(iv, 'hex'));
      d.setAuthTag(Buffer.from(tag, 'hex'));
      return { plain: Buffer.concat([d.update(Buffer.from(data, 'hex')), d.final()]).toString('utf8'), kek };
    } catch {
      // coba KEK berikutnya
    }
  }
  return null;
}

export type SealState = 'current' | 'stale' | 'legacy' | 'broken';

/** Mengklasifikasikan nilai tersimpan tanpa pernah melempar. `plain` terisi bila bisa dibuka. */
export function classify(value: unknown, context: string, ring: Keyring = loadKeyring()): { state: SealState; plain: string | null } {
  if (typeof value !== 'string' || value.length === 0) return { state: 'broken', plain: null };
  if (isEnvelope(value)) {
    try {
      const plain = openString(value, context, ring);
      return { state: envelopeKid(value) === ring.active?.kid ? 'current' : 'stale', plain };
    } catch {
      return { state: 'broken', plain: null };
    }
  }
  if (isLegacyCiphertext(value)) {
    const opened = openLegacy(value, ring);
    if (!opened) return { state: 'broken', plain: null };
    // Legacy yang hanya terbuka dengan KEK lama = 'stale' (perlu rotasi); dengan KEK aktif = 'legacy' (perlu upgrade format).
    return { state: opened.kek === ring.active ? 'legacy' : 'stale', plain: opened.plain };
  }
  return { state: 'broken', plain: null };
}

/** Membuka amplop v2 ATAU format lama `iv:tag:data`; null bila tidak bisa dibuka. */
export const tryOpenAny = (value: unknown, context: string, ring?: Keyring): string | null => classify(value, context, ring).plain;
