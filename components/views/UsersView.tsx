'use client';
import { AnimatePresence, motion } from 'motion/react';
import { BellRing } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { UsersTable } from '@/components/tables/UsersTable';
import { Explainer } from '@/components/ui/Explainer';
import { apiJson } from '@/lib/client';
import type { Role, UserStatus, UserSummary } from '@/types';

type Tab = 'all' | 'pending' | 'active' | 'inactive';
const TABS: { id: Tab; label: string }[] = [
  { id: 'all', label: 'Semua' },
  { id: 'pending', label: 'Menunggu Persetujuan' },
  { id: 'active', label: 'Aktif' },
  { id: 'inactive', label: 'Ditangguhkan/Ditolak' },
];
const matchesTab = (status: UserStatus, tab: Tab) =>
  tab === 'all' || (tab === 'pending' && status === 'pending') || (tab === 'active' && status === 'active') ||
  (tab === 'inactive' && (status === 'suspended' || status === 'rejected'));

export function UsersView({ role, toast, onPendingCount }: { role: Role; toast: (m: string, t?: 'success' | 'error' | 'info') => void; onPendingCount?: (n: number) => void }) {
  const [users, setUsers] = useState<UserSummary[] | null>(null);
  const [tab, setTab] = useState<Tab>('all');
  const canManage = role === 'superadmin';

  const load = useCallback(async () => {
    try {
      const data = (await apiJson<{ data: UserSummary[] }>('/api/admin/users', 'GET')).data;
      setUsers(data);
      onPendingCount?.(data.filter((u) => u.status === 'pending').length);
    } catch (e) { toast(e instanceof Error ? e.message : 'Gagal memuat pengguna', 'error'); }
  }, [toast, onPendingCount]);
  useEffect(() => { void load(); }, [load]);

  const pendingCount = useMemo(() => users?.filter((u) => u.status === 'pending').length ?? 0, [users]);
  const counts = useMemo(() => {
    const c: Record<Tab, number> = { all: users?.length ?? 0, pending: 0, active: 0, inactive: 0 };
    users?.forEach((u) => { if (u.status === 'pending') c.pending += 1; else if (u.status === 'active') c.active += 1; else c.inactive += 1; });
    return c;
  }, [users]);
  const filtered = useMemo(() => users?.filter((u) => matchesTab(u.status, tab)) ?? null, [users, tab]);

  const onChanged = useCallback(() => { void load(); toast('Status pengguna diperbarui', 'success'); }, [load, toast]);

  return (
    <div className="space-y-4">
      <AnimatePresence initial={false}>
        {canManage && pendingCount > 0 && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="flex items-center gap-3 overflow-hidden rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
            <BellRing className="size-4 flex-none" aria-hidden />
            <span>{pendingCount} pendaftaran baru menunggu persetujuan Anda.</span>
            <button onClick={() => setTab('pending')} className="ml-auto cursor-pointer rounded-lg border border-amber-300/30 px-2.5 py-1 text-xs font-medium hover:bg-amber-300/10">Lihat</button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Filter status pengguna">
        {TABS.map((t) => {
          const active = t.id === tab;
          return (
            <button key={t.id} role="tab" aria-selected={active} onClick={() => setTab(t.id)}
              className={`relative flex-none cursor-pointer rounded-full border px-3.5 py-1.5 text-sm transition-colors ${active ? 'border-cyan-300/40 text-white' : 'border-white/10 text-slate-400 hover:text-slate-100'}`}>
              {active && <motion.span layoutId="users-tab" className="absolute inset-0 rounded-full bg-cyan-300/15" transition={{ type: 'spring', stiffness: 400, damping: 32 }} />}
              <span className="relative">{t.label}{counts[t.id] > 0 && ` (${counts[t.id]})`}</span>
            </button>
          );
        })}
      </div>

      {!canManage && <p className="text-xs text-slate-500">Mode baca-saja: hanya Superadmin yang dapat menyetujui, menolak, atau mengubah role pengguna.</p>}
      <UsersTable users={filtered} canManage={canManage} onChanged={onChanged} />
      <Explainer title="Cara membaca tabel ini" items={[
        'Pendaftar baru berstatus Menunggu sampai Superadmin menyetujui (Setuju) atau menolak (Tolak).',
        'Tangguhkan membekukan akun yang aktif. Akun Ditangguhkan atau Ditolak bisa dipulihkan dengan tombol Aktifkan.',
        'Role: viewer berarti User/Client, admin berarti Moderator/Analyst. Superadmin dan akun bertanda (env) berasal dari environment variable dan tidak bisa diubah di sini.',
        'Tombol Perangkat membuka riwayat login: perangkat, browser, IP, dan lokasi. Hanya Superadmin yang bisa mengubah status dan role.',
      ]} />
    </div>
  );
}
