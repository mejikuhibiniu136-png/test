'use client';
import { Activity, Boxes, Gauge, Radio, Users } from 'lucide-react';
import { ActivityChart } from '@/components/charts/Charts';
import { EndpointCards } from '@/components/dashboard/EndpointCards';
import { StatCard } from '@/components/dashboard/StatCard';
import { Skeleton } from '@/components/ui/Skeleton';
import { Pill, STATE_TONE } from '@/components/ui/Pill';
import { getAccountState } from '@/lib/accounts';
import { buildActivity, computeLogStats, eventLabel, timeAgo } from '@/lib/logStats';
import type { GameTable, LogEntry, TrackedAccount } from '@/types';

interface Props { loading: boolean; logs: LogEntry[]; games: GameTable[]; accounts: TrackedAccount[]; now: number; gameLabel: string; onCopyResult: (ok: boolean, label: string) => void }

export function OverviewView({ loading, logs, games, accounts, now, gameLabel, onCopyResult }: Props) {
  const total = games.reduce((s, g) => s + g.total, 0);
  const states = accounts.map((a) => getAccountState(a, now));
  const online = states.filter((s) => s === 'ONLINE').length;
  const stats = computeLogStats(logs);
  const problems = accounts.map((a, i) => ({ a, s: states[i] })).filter((x) => x.s !== 'ONLINE').slice(0, 6);

  return (
    <div className="space-y-6">
      <EndpointCards onResult={onCopyResult} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {loading ? Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-28" delay={i * 80} />) : (
          <>
            <StatCard index={0} label="Total log diterima" value={total} hint="Seluruh tabel game" icon={<Radio className="size-4" />} />
            <StatCard index={1} label="Tabel game" value={games.length} hint="Dibuat otomatis atau manual" icon={<Boxes className="size-4" />} tone="violet" />
            <StatCard index={2} label="Akun online" value={online} hint={`dari ${accounts.length} akun dilacak`} icon={<Users className="size-4" />} tone="emerald" />
            <StatCard index={3} label="Rata-rata proses" value={stats.avgProcessingMs} suffix="ms" hint={`maks ${stats.maxProcessingMs} ms`} icon={<Gauge className="size-4" />} tone="amber" />
          </>
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <section className="glass p-5 xl:col-span-2">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white"><Activity className="size-4 text-cyan-300" aria-hidden />Aktivitas · {gameLabel}</h3>
          {loading ? <Skeleton className="h-48" /> : <ActivityChart data={buildActivity(logs, now)} />}
        </section>

        <section className="glass p-5">
          <h3 className="mb-3 text-sm font-semibold text-white">Perlu perhatian</h3>
          {loading ? <Skeleton className="h-40" /> : problems.length === 0 ? <p className="text-sm text-slate-500">Semua akun online.</p> : (
            <ul className="space-y-2.5">
              {problems.map(({ a, s }) => (
                <li key={a.username} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate text-slate-200">{a.displayName || a.username}</span>
                  <span className="flex items-center gap-2"><span className="text-xs text-slate-500">{timeAgo(new Date(a.lastUpdate).getTime(), now)}</span><Pill tone={STATE_TONE[s]}>{s}</Pill></span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="glass p-5">
        <h3 className="mb-3 text-sm font-semibold text-white">Event terbaru · {gameLabel}</h3>
        {loading ? <Skeleton className="h-32" /> : logs.length === 0 ? <p className="text-sm text-slate-500">Belum ada log. Kirim data ke Universal Webhook Endpoint di atas.</p> : (
          <ul className="divide-y divide-white/5">
            {logs.slice(0, 6).map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="flex min-w-0 items-center gap-2"><Pill tone="accent">{eventLabel(l)}</Pill><span className="truncate text-slate-400">{l.gameName}</span></span>
                <time className="flex-none text-xs text-slate-500" dateTime={l.receivedAt}>{timeAgo(new Date(l.receivedAt).getTime(), now)}</time>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
