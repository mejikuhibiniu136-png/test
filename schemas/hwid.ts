import { z } from 'zod';

// Akun Roblox = username (slug a-z0-9_.-). userId & placeId angka positif (Roblox).
export const hwidBindSchema = z.object({
  accountId: z
    .string()
    .trim()
    .min(1, 'accountId wajib diisi')
    .max(64)
    .regex(/^[a-zA-Z0-9_.-]+$/, 'accountId tidak valid'),
  userId: z.union([z.string(), z.number()]).transform((v) => String(v)),
  placeId: z.union([z.string(), z.number()]).transform((v) => String(v)),
});

// Permintaan unduhan skrip ber-watermark. accountId wajib; userId/placeId opsional (jika ikatan
// belum ada, server membuatnya dari nilai ini). hwidHash eksplisit hanya dipakai saat mengikat ulang.
export const hwidDownloadSchema = z.object({
  accountId: z
    .string()
    .trim()
    .min(1, 'accountId wajib diisi')
    .max(64)
    .regex(/^[a-zA-Z0-9_.-]+$/, 'accountId tidak valid'),
  userId: z.union([z.string(), z.number()]).optional().transform((v) => (v === undefined ? undefined : String(v))),
  placeId: z.union([z.string(), z.number()]).optional().transform((v) => (v === undefined ? undefined : String(v))),
});

// Laporan kebocoran dari skrip Lua: downloadId (harus ada di Redis), HWID yang dideteksi, dan
// HWID yang diharapkan (didekripsi skrip dari payload watermark). Server memvalidasi konsistensi.
export const hwidLeakReportSchema = z.object({
  downloadId: z.string().trim().min(1).max(64),
  accountId: z.string().trim().min(1).max(64),
  expectedHwid: z.string().trim().min(1).max(64),
  detectedHwid: z.string().trim().min(1).max(64),
  reason: z.string().trim().min(1).max(300).default('hwid_mismatch'),
});

export type HwidBindInput = z.infer<typeof hwidBindSchema>;
export type HwidDownloadInput = z.infer<typeof hwidDownloadSchema>;
export type HwidLeakReportInput = z.infer<typeof hwidLeakReportSchema>;
