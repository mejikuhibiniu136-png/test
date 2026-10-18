'use client';
import { AnimatePresence } from 'motion/react';
import { Download, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { AccountCard } from '@/components/tables/AccountGrid';
import { Button } from '@/components/ui/Button';
import { Explainer } from '@/components/ui/Explainer';
import { SkeletonGrid } from '@/components/ui/Skeleton';
import { OFFLINE_AFTER_SECONDS, STALLED_AFTER_SECONDS, getAccountState, type AccountState } from '@/lib/accounts';
import { downloadText } from '@/lib/client';
import { accountsToCsv, formatDuration, latencySeries, timeAgo } from '@/lib/logStats';
import type { LogEntry, TrackedAccount } from '@/types';

const ORDER: Record<AccountState, number> = { ONLINE: 0, STALLED: 1, OFFLINE: 2 };

interface Props { loading: boolean; accounts: TrackedAccount[]; logs: LogEntry[]; now: number; isAdmin: boolean; onDelete: (a: TrackedAccount) => void; onCopyJob: (a: TrackedAccount) => void }

export function AccountsView({ loading, accounts, logs, now, isAdmin, onDelete, onCopyJob }: Props) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'ALL' | AccountState>('ALL');
  const [sort, setSort] = useState<'STATUS' | 'NAME' | 'UPTIME' | 'LATENCY'>('STATUS');

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return accounts
      .map((a) => ({ a, s: getAccountState(a, now) }))
      .filter(({ a, s }) => (status === 'ALL' || s === status) && (!q || `${a.username} ${a.displayName} ${a.gameName} ${a.jobId}`.toLowerCase().includes(q)))
      .sort((x, y) => {
        if (sort === 'NAME') return x.a.username.toLowerCase().localeCompare(y.a.username.toLowerCase());
        if (sort === 'UPTIME') return new Date(x.a.timestamp).getTime() - new Date(y.a.timestamp).getTime();
        if (sort === 'LATENCY') return y.a.latencyMs - x.a.latencyMs;
        return ORDER[x.s] - ORDER[y.s] || x.a.username.localeCompare(y.a.username);
      });
  }, [accounts, search, status, sort, now]);

  return (
    <div className="space-y-4">
      <div className="glass flex flex-wrap items-center gap-3 p-3">
        <div className="relative min-w-48 flex-1"><Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-500" aria-hidden /><input className="field pl-9" placeholder="Cari akun, game, atau Job ID…" aria-label="Cari akun" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <select className="field w-auto" aria-label="Filter status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}><option value="ALL">Semua status</option><option value="ONLINE">Online</option><option value="STALLED">Stalled</option><option value="OFFLINE">Offline</option></select>
        <select className="field w-auto" aria-label="Urutkan" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}><option value="STATUS">Urut: status</option><option value="NAME">Urut: nama</option><option value="UPTIME">Urut: uptime</option><option value="LATENCY">Urut: latensi</option></select>
        <Button size="sm" disabled={!rows.length} onClick={() => downloadText('accounts.csv', accountsToCsv(rows.map((r) => r.a), (a) => getAccountState(a, now)), 'text/csv')}><Download className="size-3.5" />CSV</Button>
        <Button size="sm" disabled={!rows.length} onClick={() => downloadText('accounts.json', JSON.stringify(rows.map((r) => ({ ...r.a, state: r.s })), null, 2), 'application/json')}><Download className="size-3.5" />JSON</Button>
      </div>

      <Explainer title="Cara membaca kartu akun" items={[
        `Setiap kartu adalah satu akun Roblox yang dikirim skrip. Online berarti data terakhir masuk kurang dari ${STALLED_AFTER_SECONDS} detik lalu, Stalled ${STALLED_AFTER_SECONDS} sampai ${OFFLINE_AFTER_SECONDS} detik, dan Offline lebih dari ${OFFLINE_AFTER_SECONDS} detik.`,
        'FPS hijau mulai 50, kuning mulai 30, di bawahnya merah. Ping hijau di bawah 150 ms, kuning di bawah 400 ms, di atasnya merah.',
        'Latensi adalah waktu pengiriman data ke server. Tren latensi diambil dari log terbaru akun itu. Sync adalah kapan data terakhir diterima.',
        'Menghapus akun hanya menghapusnya dari daftar. Akun muncul lagi jika skripnya masih mengirim data. Tombol Job ID menyalin Job ID.',
      ]} />

      {loading ? <SkeletonGrid count={6} className="h-60" /> : rows.length === 0 ? (
        <div className="glass p-10 text-center text-sm text-slate-500">{accounts.length === 0 ? 'Belum ada akun. Jalankan loadstring di executor untuk mulai melacak.' : 'Tidak ada akun yang cocok.'}</div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <AnimatePresence mode="popLayout" initial={false}>
            {rows.map(({ a, s }) => (
              <AccountCard key={a.username} acc={a} state={s} isAdmin={isAdmin} latency={latencySeries(logs, a.username)}
                uptime={s === 'OFFLINE' ? '-' : formatDuration((now - new Date(a.timestamp).getTime()) / 1000)}
                syncText={timeAgo(new Date(a.lastUpdate).getTime(), now)} onDelete={onDelete} onCopyJob={onCopyJob} />
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
