// Menjalankan pekerjaan setelah respons dikirim. Di Next.js memakai `after()` (Vercel menjaga fungsi
// tetap hidup sampai selesai); di luar lingkup request (tes, skrip) jatuh ke promise biasa.
import { after } from 'next/server';

export type Scheduler = (task: () => Promise<unknown>) => void | Promise<void>;

export const scheduleBackground: Scheduler = (task) => {
  const safe = () => task().catch((err) => console.error('[background]', err instanceof Error ? err.message : err));
  try {
    after(safe);
  } catch {
    void safe();
  }
};
