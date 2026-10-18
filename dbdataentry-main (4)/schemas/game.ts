import { z } from 'zod';

export const gameNameSchema = z
  .string()
  .transform((s) => s.replace(/[\u0000-\u001f\u007f]/g, '').trim())
  .pipe(z.string().min(2, 'Nama minimal 2 karakter').max(64, 'Nama maksimal 64 karakter'));

export const createGameSchema = z.object({ name: gameNameSchema });
export const renameGameSchema = z.object({ name: gameNameSchema });
