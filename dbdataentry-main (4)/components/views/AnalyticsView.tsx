'use client';
import { useMemo } from 'react';
import { BarList } from '@/components/charts/Charts';
import { StatCard } from '@/components/dashboard/StatCard';
import { Skeleton } from '@/components/ui/Skeleton';
import { computeLogStats } from '@/lib/logStats';
import { Layers, Sparkles, Trophy } from 'lucide-react';
import type { LogEntry } from '@/types';

export function AnalyticsView({ loading, logs, gameLabel }: { loading: boolean; logs: LogEntry[]; gameLabel: string }) {
  const s = useMemo(() => computeLogStats(logs), [logs]);
  if (loading) return <div className="grid gap-4 md:grid-cols-2">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-56" delay={i * 80} />)}</div>;
  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-400">Dihitung dari {logs.length.toLocaleString('id-ID')} log yang dimuat · {gameLabel}</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard index={0} label="Floor tertinggi" value={s.maxFloor} icon={<Layers className="size-4" />} />
        <StatCard index={1} label="Unit baru" value={s.totalUnits} hint={s.highestRarity !== '-' ? `Terlangka ${s.highestRarity}` : undefined} icon={<Sparkles className="size-4" />} tone="violet" />
        <StatCard index={2} label="Pemain teratas" value={s.topUsers[0]?.count ?? 0} hint={s.topUsers[0]?.name ?? '-'} icon={<Trophy className="size-4" />} tone="amber" />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <section className="glass p-5"><h3 className="mb-4 text-sm font-semibold text-white">Event terbanyak</h3><BarList items={s.topEvents} /></section>
        <section className="glass p-5"><h3 className="mb-4 text-sm font-semibold text-white">Pengguna teraktif</h3><BarList items={s.topUsers} /></section>
        <section className="glass p-5 md:col-span-2"><h3 className="mb-4 text-sm font-semibold text-white">Drop terbanyak</h3><BarList items={s.topLoot} empty="Belum ada data drop pada log ini." /></section>
      </div>
    </div>
  );
}
