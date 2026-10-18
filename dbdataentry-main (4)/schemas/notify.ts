import { z } from 'zod';
import { ALERT_KINDS, SEVERITIES } from '@/lib/notify/types';

// Superadmin: satu formulir dinamis. `platform` menentukan kolom mana yang relevan; kolom rahasia
// boleh dikosongkan saat memperbarui (nilai tersimpan dipertahankan), tetapi wajib saat pertama kali
// atau saat berpindah platform.
export const notifyUpdateSchema = z.object({
  platform: z.enum(['discord', 'telegram']),
  enabled: z.boolean().optional(),
  minSeverity: z.enum(SEVERITIES).optional(),
  kinds: z.union([z.literal('all'), z.array(z.enum(ALERT_KINDS)).min(1, 'Pilih minimal satu jenis alert')]).optional(),
  webhookUrl: z.string().trim().max(300).optional(),
  botToken: z.string().trim().max(120).optional(),
  chatId: z.string().trim().max(64).optional(),
});

export type NotifyUpdateInput = z.infer<typeof notifyUpdateSchema>;
