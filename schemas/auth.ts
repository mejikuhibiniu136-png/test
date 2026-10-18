import { z } from 'zod';

export const USERNAME_PATTERN = /^[a-zA-Z0-9_.-]{3,32}$/;

export const loginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(256),
});

export const registerSchema = z.object({
  username: z
    .string()
    .trim()
    .regex(USERNAME_PATTERN, 'Username 3-32 karakter: huruf, angka, titik, garis bawah, atau strip'),
  password: z.string().min(8, 'Password minimal 8 karakter').max(128, 'Password maksimal 128 karakter'),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
