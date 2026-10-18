import { z } from 'zod';

export const CONTROL_COMMANDS = ['KILL', 'PAUSE', 'RESUME'] as const;

// Perintah kontrol ke akun Roblox (kill-switch). TTL default 60 detik: cukup bagi skrip polling
// (interval 5 detik) untuk menangkap perintah, lalu perintah kedaluwarsa sendiri.
export const controlCommandSchema = z.object({
  accountId: z
    .string()
    .trim()
    .min(1, 'accountId wajib diisi')
    .max(64)
    .regex(/^[a-zA-Z0-9_.-]+$/, 'accountId tidak valid'),
  command: z.enum(CONTROL_COMMANDS),
  ttlSeconds: z.number().int().min(5).max(300).optional(),
});

export const controlClearSchema = z.object({
  accountId: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9_.-]+$/, 'accountId tidak valid'),
});

export type ControlCommandInput = z.infer<typeof controlCommandSchema>;
export type ControlClearInput = z.infer<typeof controlClearSchema>;
