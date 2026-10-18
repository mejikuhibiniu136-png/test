'use client';
import { Eraser } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Explainer } from '@/components/ui/Explainer';
import { apiJson } from '@/lib/client';
import type { Notify } from '@/components/views/system/format';

// Retensi berbasis waktu, melengkapi batas jumlah log (LOG_MAX_*). 0 = nonaktif.
export function RetentionPanel({ days, busy, onSave, toast }: { days: number; busy: boolean; onSave: (days: number) => void; toast: Notify }) {
  const [value, setValue] = useState(String(days));
  const [purging, setPurging] = useState(false);
  useEffect(() => { setValue(String(days)); }, [days]);

  const parsed = /^\d{1,4}$/.test(value.trim()) ? Number(value) : NaN;
  const valid = Number.isInteger(parsed) && parsed >= 0 && parsed <= 3650;
  const dirty = value.trim() !== String(days);

  const purge = async () => {
    setPurging(true);
    try {
      const res = await apiJson<{ data: { removed: number; keys: number } }>('/api/admin/retention', 'POST');
      toast(`${res.data.removed.toLocaleString('id-ID')} log lama dihapus (${res.data.keys} tabel diperiksa)`, 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Gagal membersihkan', 'error');
    } finally {
      setPurging(false);
    }
  };

  return (
    <section className="glass p-5">
      <h3 className="mb-1 text-sm font-semibold text-white">Retensi log</h3>
      <p className="mb-4 text-xs leading-relaxed text-slate-500">Log lebih tua dari batas ini dihapus. Isi 0 untuk menonaktifkan. Pembersihan otomatis berjalan harian (03:00 UTC) lewat Vercel Cron dan butuh <code className="text-slate-300">CRON_SECRET</code> di Vercel.</p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm text-slate-200">
          Simpan
          <input type="number" inputMode="numeric" min={0} max={3650} value={value} onChange={(e) => setValue(e.target.value)} aria-label="Retensi log (hari)" aria-invalid={!valid} className="field w-24 py-1.5 text-right text-sm" disabled={busy} />
          hari
        </label>
        <Button variant="primary" disabled={busy || !dirty || !valid} onClick={() => onSave(parsed)}>Simpan</Button>
        <Button disabled={busy || purging || dirty || days <= 0} onClick={purge}><Eraser className="size-3.5" />{purging ? 'Membersihkan…' : 'Bersihkan sekarang'}</Button>
      </div>
      {!valid && <p className="mt-2 text-xs text-rose-300">Isi bilangan bulat 0–3650.</p>}
      <Explainer className="mt-4" title="Cara kerja retensi" items={[
        'Log yang lebih tua dari jumlah hari yang diisi akan dihapus. Isi 0 untuk menonaktifkan. Batas maksimal 3650 hari.',
        'Tombol Simpan menyimpan pengaturan. "Bersihkan sekarang" menjalankan pembersihan saat itu juga dan hanya aktif jika pengaturan sudah disimpan dan lebih dari 0.',
        'Pembersihan otomatis berjalan harian pukul 03:00 UTC lewat Vercel Cron.',
      ]} />
    </section>
  );
}
