'use client';
import { RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Explainer } from '@/components/ui/Explainer';
import { Skeleton } from '@/components/ui/Skeleton';
import { apiJson } from '@/lib/client';
import { formatWhen, type Notify } from '@/components/views/system/format';
import type { AuditAction, AuditEntry } from '@/types';

const LABEL: Record<AuditAction, string> = {
  'settings.update': 'Ubah pengaturan',
  'apikey.create': 'Buat API Key',
  'apikey.revoke': 'Cabut API Key',
  'receiver.toggle': 'Saklar receiver',
  'user.update': 'Ubah pengguna',
  'logs.clear': 'Hapus log',
  'game.delete': 'Hapus tabel game',
  'game.rename': 'Ganti nama tabel',
  'account.delete': 'Hapus akun tracker',
  'encryption.rotate': 'Enkripsi ulang secret',
  'retention.purge': 'Pembersihan retensi',
  'notify.update': 'Ubah saluran notifikasi',
  'notify.test': 'Uji notifikasi',
  'session.revoke': 'Cabut sesi',
  'queue.drain': 'Kuras antrean ingest',
  'queue.setting': 'Ubah mode antrean',
  'crypto.sweep': 'Sapuan rotasi KEK',
};

// Jejak 50 aksi sensitif terakhir. Teks berasal dari input pengguna, jadi hanya dirender sebagai teks.
export function AuditPanel({ toast }: { toast: Notify }) {
  const [rows, setRows] = useState<AuditEntry[] | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows((await apiJson<{ data: AuditEntry[] }>('/api/admin/audit?limit=50', 'GET')).data); } catch (e) { toast(e instanceof Error ? e.message : 'Gagal memuat audit', 'error'); } finally { setLoading(false); }
  }, [toast]);
  useEffect(() => { void load(); }, [load]);

  return (
    <section className="glass p-5">
      <div className="mb-1 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-white">Audit log</h3>
        <Button size="sm" disabled={loading} onClick={() => void load()}><RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />Muat ulang</Button>
      </div>
      <p className="mb-4 text-xs text-slate-500">Siapa mengubah apa dan kapan. Nilai rahasia tidak pernah dicatat. Disimpan maksimal 1.000 entri terbaru.</p>
      {!rows ? <Skeleton className="h-24" /> : rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-white/10 p-4 text-center text-sm text-slate-500">Belum ada aktivitas tercatat.</p>
      ) : (
        <ul className="divide-y divide-white/5">
          {rows.map((r) => (
            <li key={r.id} className="grid gap-x-4 gap-y-0.5 py-2.5 text-sm sm:grid-cols-[11rem_1fr]">
              <span className="text-xs text-slate-500">{formatWhen(r.at)}</span>
              <div className="min-w-0">
                <span className="text-slate-100">{LABEL[r.action] ?? r.action}</span>
                {r.target && <span className="text-slate-300"> · {r.target}</span>}
                <div className="break-words text-xs text-slate-500">{r.actor} ({r.role}){r.ip ? ` · ${r.ip}` : ''}{r.detail ? ` · ${r.detail}` : ''}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Explainer className="mt-4" title="Cara membaca audit log" items={[
        'Setiap baris memuat waktu, aksi, target, lalu pelaku beserta role, IP, dan detail.',
        'Panel menampilkan 50 aksi terbaru. Yang tersimpan maksimal 1.000 entri dan nilai rahasia tidak pernah dicatat.',
        'Pakai untuk menelusuri siapa mengubah pengaturan, mencabut key, atau menghapus tabel.',
      ]} />
    </section>
  );
}
