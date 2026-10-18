// Pintu masuk tunggal bagi pemicu alert di seluruh aplikasi. Mengirim di latar belakang agar tidak
// menambah latensi pada jalur panas; tidak pernah melempar.
import { scheduleBackground, type Scheduler } from '@/lib/background';
import { dispatchAlert, type DispatchDeps } from '@/lib/notify/dispatcher';
import type { AlertEvent } from '@/lib/notify/types';
import { getRedis, type RedisLike } from '@/lib/redis';

export interface EmitDeps extends DispatchDeps { redis?: RedisLike; schedule?: Scheduler }

export async function emitAlert(event: AlertEvent, deps: EmitDeps = {}): Promise<void> {
  try {
    const redis = deps.redis ?? getRedis();
    await (deps.schedule ?? scheduleBackground)(() => dispatchAlert(redis, event, deps));
  } catch (err) {
    console.error('[notify] emit gagal:', err instanceof Error ? err.message : 'unknown');
  }
}
