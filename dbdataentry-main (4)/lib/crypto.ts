// Enkripsi sisi server untuk nilai sensitif yang disimpan di Upstash Redis (WEBHOOK_SECRET,
// API_KEY di config:settings). AES-256-GCM via Node crypto; kunci HANYA dari ENCRYPTION_KEY
// (.env Vercel), tidak pernah disimpan di Redis. Format ciphertext: "iv:authTag:encryptedData"
// (ketiganya hex), sesuai spesifikasi agar mudah diverifikasi/diaudit.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { ConfigError, getEncryptionKeyHex, tryGetEncryptionKeyHex, tryGetPreviousEncryptionKeyHex } from '@/lib/env';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12; // ukuran IV standar GCM
const CIPHERTEXT_FORMAT = /^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/i;

function keyBuffer(): Buffer {
  return Buffer.from(getEncryptionKeyHex(), 'hex');
}

export function encrypt(plainText: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, keyBuffer(), iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decryptWithKey(ciphertext: string, keyHex: string): string {
  const [ivHex, tagHex, dataHex] = ciphertext.split(':');
  const decipher = createDecipheriv(ALGO, Buffer.from(keyHex, 'hex'), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
}

// Rotasi kunci: ENCRYPTION_KEY dicoba lebih dulu; bila tag GCM tidak cocok dan
// ENCRYPTION_KEY_PREVIOUS valid, kunci lama dicoba. Menulis selalu memakai kunci saat ini.
export function decrypt(ciphertext: string): string {
  if (!CIPHERTEXT_FORMAT.test(ciphertext)) throw new Error('Format ciphertext tidak valid');
  try {
    return decryptWithKey(ciphertext, getEncryptionKeyHex());
  } catch (err) {
    const previous = tryGetPreviousEncryptionKeyHex();
    if (err instanceof ConfigError || previous === null) throw err;
    return decryptWithKey(ciphertext, previous);
  }
}

export type CiphertextKey = 'current' | 'previous' | 'broken';

// Menentukan kunci mana yang membuka ciphertext (tanpa melempar). 'previous' = perlu dienkripsi ulang.
export function classifyCiphertext(ciphertext: string): { key: CiphertextKey; plain: string | null } {
  if (!CIPHERTEXT_FORMAT.test(ciphertext)) return { key: 'broken', plain: null };
  const current = tryGetEncryptionKeyHex();
  if (current) {
    try {
      return { key: 'current', plain: decryptWithKey(ciphertext, current) };
    } catch {
      // lanjut ke kunci lama
    }
  }
  const previous = tryGetPreviousEncryptionKeyHex();
  if (previous) {
    try {
      return { key: 'previous', plain: decryptWithKey(ciphertext, previous) };
    } catch {
      // tidak ada kunci yang cocok
    }
  }
  return { key: 'broken', plain: null };
}

export function isCiphertext(value: unknown): value is string {
  return typeof value === 'string' && CIPHERTEXT_FORMAT.test(value);
}

// Dekripsi yang tidak pernah melempar: dipakai jalur yang harus tetap berjalan (webhook
// receiver) walau ENCRYPTION_KEY belum diisi atau nilainya rusak.
export function tryDecrypt(ciphertext: string | null | undefined): string | null {
  if (!ciphertext) return null;
  try {
    return decrypt(ciphertext);
  } catch {
    return null;
  }
}
