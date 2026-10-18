import { z } from 'zod';

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

// Angka diubah menjadi string, teks di-trim dan karakter kontrol dibuang.
const text = (max: number) =>
  z.preprocess(
    (v) => (typeof v === 'number' && Number.isFinite(v) ? String(v) : v),
    z
      .string()
      .transform((s) => s.replace(CONTROL_CHARS, '').trim())
      .pipe(z.string().min(1).max(max))
  );

const httpsUrl = z
  .string()
  .max(512)
  .refine((v) => {
    try {
      return new URL(v).protocol === 'https:';
    } catch {
      return false;
    }
  });

const isoLike = z.union([z.string().max(64), z.number()]);

// Status akun dari script Lua: STRICT. Payload yang tidak cocok tidak memperbarui akun
// (tetap disimpan sebagai log biasa, tidak dibuang).
export const accountPayloadSchema = z.object({
  username: text(64).refine((v) => !FORBIDDEN_KEYS.has(v), 'username tidak valid'),
  displayName: text(64).optional(),
  state: z
    .preprocess((v) => (typeof v === 'string' ? v.trim().toUpperCase() : v), z.enum(['ONLINE', 'OFFLINE']))
    .optional(),
  gameName: text(128).optional(),
  userId: text(32).optional(),
  placeId: text(32).optional(),
  jobId: text(128).optional(),
  event: text(64).optional(),
  latencyMs: z.number().finite().min(0).max(60_000).optional(),
  // Telemetri klien: opsional, dan nilai yang tidak valid diabaikan (tidak menggagalkan seluruh payload).
  fps: z.number().finite().min(0).max(1000).optional().catch(undefined),
  pingMs: z.number().finite().min(0).max(60_000).optional().catch(undefined),
  memoryMb: z.number().finite().min(0).max(65_536).optional().catch(undefined),
  sessionStart: isoLike.optional(),
  timestamp: isoLike.optional(),
  avatarUrl: httpsUrl.optional(),
});

export type AccountPayload = z.infer<typeof accountPayloadSchema>;
