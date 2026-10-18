// Enkripsi ringan untuk badan skrip Lua: keystream xorshift32 yang di-seed dari (API key + nonce).
// Tujuannya BUKAN rahasia mutlak (pemegang key pasti bisa membuka), melainkan:
//   1) badan skrip tidak terbaca oleh siapa pun tanpa key (cache/CDN, scanner, log proxy),
//   2) setiap unduhan memakai nonce baru sehingga ciphertext selalu berbeda.
// Implementasi Lua pasangannya ada di public/loader/loader.lua dan harus identik.
import { randomBytes } from 'node:crypto';

export const SCRIPT_MAGIC = '--dbde-ok\n'; // penanda "key benar & data utuh" yang diperiksa loader

// Hash sederhana (djb2) dengan aritmetika yang tetap eksak di Lua (h * 33 < 2^53).
function seedOf(text: string): number {
  let h = 5381;
  for (const b of Buffer.from(text, 'utf8')) h = (h * 33 + b) % 4_294_967_296;
  return h || 0x9e3779b9;
}

function* keystream(seed: number): Generator<number> {
  let x = seed >>> 0;
  for (;;) {
    x = (x ^ (x << 13)) >>> 0;
    x = (x ^ (x >>> 17)) >>> 0;
    x = (x ^ (x << 5)) >>> 0;
    yield (x >>> 8) & 0xff;
  }
}

function xorHex(input: Uint8Array, key: string, nonce: string): string {
  const ks = keystream(seedOf(key + nonce));
  let out = '';
  for (const byte of input) out += (byte ^ (ks.next().value as number)).toString(16).padStart(2, '0');
  return out;
}

export function sealScript(plain: string, key: string): { nonce: string; hex: string } {
  const nonce = randomBytes(8).toString('hex');
  return { nonce, hex: xorHex(Buffer.from(SCRIPT_MAGIC + plain, 'utf8'), key, nonce) };
}

// Dipakai tes untuk memastikan algoritme dua sisi konsisten (cermin dari decrypt() di loader.lua).
export function openScript(hex: string, key: string, nonce: string): string {
  const bytes = Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));
  const ks = keystream(seedOf(key + nonce));
  return Buffer.from(bytes.map((b) => b ^ (ks.next().value as number))).toString('utf8');
}
