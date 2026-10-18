// Keyring KEK (Key Encryption Key). KEK hanya hidup di Environment Variable, tidak pernah di Redis.
//
//   ENCRYPTION_KEY           KEK aktif (hex 32-byte). Dipakai untuk semua penyegelan baru.
//   ENCRYPTION_KEY_PREVIOUS  KEK lama (opsional), hanya untuk MEMBUKA / re-wrap.
//   ENCRYPTION_KEYS_RETIRED  daftar KEK lama tambahan, dipisah koma (opsional).
//
// Setiap KEK punya `kid` deterministik = potongan SHA-256 dari bytes kuncinya. Karena kid ikut
// tersimpan di setiap amplop, pembuka langsung memilih KEK yang tepat (tanpa trial-decryption)
// dan tidak perlu ada konfigurasi id terpisah. SHA-256 bersifat satu-arah, jadi kid tidak
// membocorkan kunci.
import { createHash, hkdfSync } from 'node:crypto';
import { ConfigError } from '@/lib/env';

type Env = Record<string, string | undefined>;

export interface Kek {
  kid: string;
  /** 32 byte KEK mentah (juga dipakai oleh format legacy iv:tag:data). */
  raw: Buffer;
  /** Kunci turunan untuk key-wrap (ChaCha20-Poly1305). */
  wrapKey: Buffer;
  /** Kunci turunan untuk HMAC-SHA256 (pemisahan domain dari wrapKey). */
  macKey: Buffer;
}

export interface Keyring {
  active: Kek | null;
  /** Semua KEK yang dikenal (aktif + lama), diindeks per kid. */
  byKid: ReadonlyMap<string, Kek>;
  /** Urutan untuk membuka format legacy (aktif lebih dulu). */
  ordered: readonly Kek[];
}

const HEX64 = /^[0-9a-fA-F]{64}$/;
const SALT = Buffer.from('dbdataentry/kek/v2', 'utf8');

const derive = (ikm: Buffer, info: string): Buffer => Buffer.from(hkdfSync('sha256', ikm, SALT, Buffer.from(info, 'utf8'), 32));

export function kekFromHex(hex: string): Kek {
  const raw = Buffer.from(hex, 'hex');
  const kid = createHash('sha256').update('dbde-kid-v1').update(raw).digest().subarray(0, 8).toString('base64url');
  return { kid, raw, wrapKey: derive(raw, 'dbdataentry/wrap/chacha20-poly1305'), macKey: derive(raw, 'dbdataentry/mac/hmac-sha256') };
}

export function loadKeyring(env: Env = process.env): Keyring {
  const hexes: string[] = [];
  const add = (v: string | undefined) => {
    const t = (v ?? '').trim();
    if (HEX64.test(t) && !hexes.includes(t.toLowerCase())) hexes.push(t.toLowerCase());
  };
  add(env.ENCRYPTION_KEY);
  add(env.ENCRYPTION_KEY_PREVIOUS);
  for (const part of (env.ENCRYPTION_KEYS_RETIRED ?? '').split(',')) add(part);

  const activeHex = (env.ENCRYPTION_KEY ?? '').trim();
  const keks = hexes.map(kekFromHex);
  const active = HEX64.test(activeHex) ? keks.find((k) => k.raw.equals(Buffer.from(activeHex, 'hex'))) ?? null : null;
  return { active, byKid: new Map(keks.map((k) => [k.kid, k])), ordered: active ? [active, ...keks.filter((k) => k !== active)] : keks };
}

export function requireActiveKek(ring: Keyring): Kek {
  if (!ring.active) throw new ConfigError(['ENCRYPTION_KEY'], 'ENCRYPTION_KEY harus berupa string hex 32-byte (64 karakter)');
  return ring.active;
}
