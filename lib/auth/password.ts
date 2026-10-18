// Hashing password. Argon2id lewat @node-rs/argon2 (implementasi Rust, modul native);
// hash bcrypt lama tetap bisa diverifikasi (mis. ADMIN_PASSWORD_HASH dari versi sebelumnya).
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import bcrypt from 'bcryptjs';

// Parameter OWASP untuk Argon2id: m=19 MiB, t=2, p=1. Algoritma bawaan library adalah Argon2id.
const ARGON_OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;
const MAX_BCRYPT_COST = 14; // bcryptjs (JS murni) sangat lambat di atas ini

export async function hashPassword(password: string): Promise<string> {
  return argonHash(password, ARGON_OPTIONS);
}

export type HashKind = 'argon2id' | 'bcrypt' | 'unknown';

export function detectHashKind(stored: string): HashKind {
  if (stored.startsWith('$argon2id$')) return 'argon2id';
  if (/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(stored)) return 'bcrypt';
  return 'unknown';
}

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  try {
    switch (detectHashKind(stored)) {
      case 'argon2id':
        return await argonVerify(stored, password);
      case 'bcrypt': {
        const cost = Number(stored.slice(4, 6));
        if (cost > MAX_BCRYPT_COST) return false;
        return await bcrypt.compare(password, stored);
      }
      default:
        return false;
    }
  } catch {
    return false;
  }
}

// Hash tiruan untuk menyamakan waktu respons saat username tidak ada.
let dummyHash: Promise<string> | null = null;
export async function verifyAgainstDummy(password: string): Promise<false> {
  dummyHash ??= hashPassword('dummy-password-for-timing');
  await verifyPassword(await dummyHash, password);
  return false;
}
