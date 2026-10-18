import { getRedis } from '@/lib/redis';
import { readRuntimeSettings } from '@/lib/settings';

export const dynamic = 'force-dynamic';

const HEADERS = { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' };

// Status maintenance untuk skrip Lua yang sedang berjalan (dipanggil tiap beberapa detik).
// Publik dan tanpa data akun: hanya ON/OFF dan teks yang memang ditampilkan ke pemain. Tetap
// dijawab 200 saat maintenance supaya skrip bisa membaca isinya; tidak melewati penerima webhook
// (/api/receiver/*), jadi tidak ikut ditolak oleh mode maintenance. Pembacaan memakai cache
// runtime 5 dtk, sehingga banyak klien tidak melipatgandakan command Redis.
export async function GET() {
  try {
    const settings = await readRuntimeSettings(getRedis());
    return Response.json(
      { success: true, maintenance: settings.maintenanceMode, message: settings.maintenanceMode ? settings.maintenanceMessage : '' },
      { headers: HEADERS }
    );
  } catch (err) {
    console.error('[maintenance] gagal membaca status:', err instanceof Error ? err.message : err);
    // Bukan 200: klien menganggap cek gagal dan mempertahankan status terakhirnya.
    return Response.json({ success: false, message: 'Status tidak tersedia' }, { status: 503, headers: HEADERS });
  }
}
