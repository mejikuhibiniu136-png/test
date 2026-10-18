'use client';
import { Copy, KeyRound, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Explainer } from '@/components/ui/Explainer';
import { Pill } from '@/components/ui/Pill';
import { Skeleton } from '@/components/ui/Skeleton';
import { apiJson, copyText } from '@/lib/client';
import { formatWhen, type Notify } from '@/components/views/system/format';
import type { ApiKeyView } from '@/types';

const EXPIRY = [
  { label: 'Tanpa kedaluwarsa', value: '' },
  { label: '30 hari', value: '30' },
  { label: '90 hari', value: '90' },
  { label: '1 tahun', value: '365' },
];

interface Props {
  toast: Notify;
  /** Saklar "Wajibkan API Key" (pengaturan dinamis). */
  required: boolean;
  busy: boolean;
  onToggleRequired: (next: boolean) => void;
}

export function ApiKeysPanel({ toast, required, busy, onToggleRequired }: Props) {
  const [keys, setKeys] = useState<ApiKeyView[] | null>(null);
  const [label, setLabel] = useState('');
  const [expiry, setExpiry] = useState('');
  const [working, setWorking] = useState(false);
  const [created, setCreated] = useState<{ key: string; label: string } | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setKeys((await apiJson<{ data: ApiKeyView[] }>('/api/admin/apikey', 'GET')).data); } catch (e) { toast(e instanceof Error ? e.message : 'Gagal memuat API Key', 'error'); }
  }, [toast]);
  useEffect(() => { void load(); }, [load]);

  const activeCount = keys ? keys.filter((k) => !k.expired).length : 0;

  const create = async () => {
    const name = label.trim();
    if (!name) return;
    setWorking(true);
    try {
      const res = await apiJson<{ apiKey: string; data: ApiKeyView }>('/api/admin/apikey', 'POST', { label: name, expiresInDays: expiry ? Number(expiry) : null });
      setCreated({ key: res.apiKey, label: res.data.label });
      setLabel('');
      toast('API Key dibuat', 'success');
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Gagal membuat API Key', 'error');
    } finally {
      setWorking(false);
    }
  };

  // Mencabut memutus klien yang memakainya: klik pertama meminta konfirmasi, klik kedua mencabut.
  const revoke = async (id: string) => {
    if (confirmId !== id) {
      setConfirmId(id);
      setTimeout(() => setConfirmId((c) => (c === id ? null : c)), 4000);
      return;
    }
    setConfirmId(null);
    setWorking(true);
    try {
      await apiJson(`/api/admin/apikey?id=${encodeURIComponent(id)}`, 'DELETE');
      toast('API Key dicabut', 'success');
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Gagal mencabut', 'error');
    } finally {
      setWorking(false);
    }
  };

  const copyKey = async () => { if (created && (await copyText(created.key))) toast('API Key disalin', 'success'); };

  return (
    <section className="glass p-5">
      <h3 className="mb-1 text-sm font-semibold text-white">API Key</h3>
      <p className="mb-4 text-xs text-slate-500">Satu key per klien, jadi bisa dicabut sendiri-sendiri. Kirim lewat header <code className="text-slate-300">x-api-key</code>, <code className="text-slate-300">Authorization: Bearer</code>, atau <code className="text-slate-300">?key=</code>. Hanya Superadmin.</p>

      <label className="mb-4 flex items-start justify-between gap-4 rounded-xl border border-white/10 bg-black/20 px-4 py-3">
        <span>
          <span className="block text-sm text-slate-200">Wajibkan API Key di receiver</span>
          <span className="mt-1 block text-xs leading-relaxed text-slate-500">Saat nyala, request tanpa key valid ditolak (401). Skrip Lua bawaan <code className="text-slate-300">/scripts/account_status.lua</code> tidak membawa key, jadi ikut ditolak. Nyalakan hanya bila semua pengirim sudah memakai key.</span>
          {!required && keys && activeCount === 0 && <span className="mt-1 block text-xs text-amber-300">Buat minimal satu key aktif dulu.</span>}
        </span>
        <input type="checkbox" className="mt-1 size-4 flex-none accent-cyan-400" checked={required} disabled={busy || (!required && activeCount === 0)} onChange={(e) => onToggleRequired(e.target.checked)} aria-label="Wajibkan API Key di receiver" />
      </label>

      <form className="mb-4 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); void create(); }}>
        <input className="field min-w-40 flex-1 text-sm" placeholder="Label, mis. skrip akun A" maxLength={40} value={label} onChange={(e) => setLabel(e.target.value)} aria-label="Label API Key" disabled={working} />
        <select className="field w-auto text-sm" value={expiry} onChange={(e) => setExpiry(e.target.value)} aria-label="Masa berlaku" disabled={working}>
          {EXPIRY.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <Button type="submit" variant="primary" disabled={working || !label.trim()}><Plus className="size-3.5" />Buat key</Button>
      </form>

      {created && (
        <div className="mb-4 rounded-xl border border-amber-400/30 bg-amber-400/10 p-3">
          <p className="mb-2 text-xs text-amber-200">Salin sekarang. Key &quot;{created.label}&quot; tidak akan ditampilkan lagi dan tidak bisa dipulihkan.</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto rounded-lg bg-black/40 px-2.5 py-1.5 text-xs text-emerald-200">{created.key}</code>
            <Button size="sm" onClick={copyKey}><Copy className="size-3.5" />Salin</Button>
            <Button size="sm" variant="subtle" onClick={() => setCreated(null)}>Tutup</Button>
          </div>
        </div>
      )}

      {!keys ? <Skeleton className="h-20" /> : keys.length === 0 ? (
        <p className="rounded-xl border border-dashed border-white/10 p-4 text-center text-sm text-slate-500">Belum ada API Key.</p>
      ) : (
        <ul className="divide-y divide-white/5">
          {keys.map((k) => (
            <li key={k.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <KeyRound className="size-3.5 flex-none text-slate-500" aria-hidden />
                  <span className="truncate text-sm font-medium text-slate-100">{k.label}</span>
                  <Pill tone={k.expired ? 'bad' : 'ok'}>{k.expired ? 'Kedaluwarsa' : 'Aktif'}</Pill>
                </div>
                <div className="mt-1 font-mono text-xs text-slate-500">{k.hint}</div>
                <div className="mt-0.5 text-xs text-slate-500">Dibuat {formatWhen(k.createdAt)} oleh {k.createdBy} · {k.expiresAt ? `berlaku sampai ${formatWhen(k.expiresAt)}` : 'tanpa kedaluwarsa'} · terakhir dipakai {formatWhen(k.lastUsedAt)}</div>
              </div>
              <Button size="sm" variant="danger" disabled={working} onClick={() => void revoke(k.id)}><Trash2 className="size-3.5" />{confirmId === k.id ? 'Yakin cabut?' : 'Cabut'}</Button>
            </li>
          ))}
        </ul>
      )}
      <Explainer className="mt-4" title="Cara memakai API Key" ordered items={[
        'Isi label, pilih masa berlaku, lalu klik "Buat key". Key hanya tampil sekali, jadi salin sebelum ditutup.',
        <>Pasang key di klien lewat header <code className="text-slate-300">x-api-key</code>, <code className="text-slate-300">Authorization: Bearer</code>, atau <code className="text-slate-300">?key=</code>.</>,
        'Saklar "Wajibkan API Key" membuat request tanpa key valid ditolak (401). Skrip Lua bawaan tidak membawa key, jadi nyalakan hanya setelah semua pengirim memakai key. Saklar baru bisa dinyalakan jika ada key aktif.',
        'Cabut memutus klien yang memakai key itu. Klik pertama meminta konfirmasi, klik kedua mencabut.',
      ]} />
    </section>
  );
}
