import { z } from 'zod';

// Superadmin: approve/reject/suspend pengguna, dan/atau promosikan ke role admin.
export const userUpdateSchema = z
  .object({
    status: z.enum(['pending', 'active', 'suspended', 'rejected']).optional(),
    role: z.enum(['admin', 'viewer']).optional(),
  })
  .refine((v) => v.status !== undefined || v.role !== undefined, 'Isi minimal status atau role');

// Superadmin: Pengaturan Dinamis Redis (MAINTENANCE_MODE, MAINTENANCE_MESSAGE, RATE_LIMIT_PER_MIN, proteksi Lua,
// Webhook Secret, API Key). Semua field opsional: hanya field yang dikirim yang diperbarui.
export const settingsUpdateSchema = z.object({
  maintenanceMode: z.boolean().optional(),
  // String kosong = kembali ke teks bawaan. Karakter kontrol dibersihkan server saat disimpan.
  maintenanceMessage: z.string().max(200, 'Teks maintenance maksimal 200 karakter').optional(),
  rateLimitPerMin: z.number().int().min(10).max(100_000).optional(),
  luaObfuscationEnabled: z.boolean().optional(),
  apiKeyRequired: z.boolean().optional(),
  logRetentionDays: z.number().int().min(0).max(3650).optional(),
  ingestQueueEnabled: z.boolean().optional(),
  webhookSecret: z.string().trim().min(8, 'Minimal 8 karakter').max(256).optional().or(z.literal('')),
});

// Superadmin: buat API Key dashboard. expiresInDays kosong/null = tidak kedaluwarsa.
export const apiKeyCreateSchema = z.object({
  label: z.string().trim().min(1, 'Label wajib diisi').max(40, 'Label maksimal 40 karakter'),
  expiresInDays: z.number().int().min(1).max(3650).nullable().optional(),
});

export type UserUpdateInput = z.infer<typeof userUpdateSchema>;
export type SettingsUpdateInput = z.infer<typeof settingsUpdateSchema>;
