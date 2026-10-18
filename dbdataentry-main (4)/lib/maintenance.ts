// Mode maintenance: saat MAINTENANCE_MODE menyala (Pengaturan Sistem, khusus Superadmin), semua
// jalur masuk data ditolak dengan 503. Dicek dua kali, di proxy.ts (paling depan) dan di
// lib/ingest/handler.ts (pagar terakhir), keduanya lewat modul ini supaya bentuk respons sama.
// Dashboard, login, API admin, dan /scripts/* sengaja tetap terbuka: Superadmin harus bisa
// mematikan maintenance, dan skrip Lua harus bisa dimuat untuk menampilkan teksnya.
import { getRedis, type RedisLike } from '@/lib/redis';
import { readRuntimeSettings } from '@/lib/settings';

export const MAINTENANCE_RETRY_SECONDS = 60;

// Jalur pengirim data: penerima webhook dan alias lamanya.
export function isIngestPath(pathname: string): boolean {
  return pathname === '/api/webhook' || pathname === '/api/receiver' || pathname.startsWith('/api/receiver/');
}

// 503 + `maintenance: true`: klien (skrip Lua) mengenali ini sebagai maintenance, bukan error server.
export function maintenanceResponse(message: string): Response {
  return Response.json(
    { success: false, maintenance: true, message },
    {
      status: 503,
      headers: {
        'Cache-Control': 'no-store',
        'Retry-After': String(MAINTENANCE_RETRY_SECONDS),
        'Access-Control-Allow-Origin': '*',
      },
    }
  );
}

// Dipakai proxy.ts. Gagal membaca Redis -> lolos (terbuka), sama seperti pengaturan runtime lain;
// handler tetap memeriksa lagi begitu Redis bisa dibaca.
export async function checkMaintenance(redis?: RedisLike): Promise<Response | null> {
  try {
    const settings = await readRuntimeSettings(redis ?? getRedis());
    return settings.maintenanceMode ? maintenanceResponse(settings.maintenanceMessage) : null;
  } catch (err) {
    console.error('[maintenance] gagal memeriksa mode maintenance:', err instanceof Error ? err.message : err);
    return null;
  }
}
