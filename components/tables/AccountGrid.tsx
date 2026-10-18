'use client';
import { motion } from 'motion/react';
import { Copy, Trash2 } from 'lucide-react';
import { memo } from 'react';
import { Sparkline } from '@/components/charts/Charts';
import { AnimatedNumber } from '@/components/ui/AnimatedNumber';
import { Button } from '@/components/ui/Button';
import { STATE_COLOR, StatusPill } from '@/components/ui/Pill';
import type { AccountState } from '@/lib/accounts';
import { safeImageUrl } from '@/lib/client';
import type { TrackedAccount } from '@/types';

interface Props { acc: TrackedAccount; state: AccountState; uptime: string; syncText: string; latency: number[]; isAdmin: boolean; onDelete: (a: TrackedAccount) => void; onCopyJob: (a: TrackedAccount) => void }

function Metric({ label, value, unit, tone }: { label: string; value: number | undefined; unit: string; tone?: string }) {
  return (
    <div className="rounded-lg bg-white/5 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="tabular text-sm font-semibold text-white" style={tone ? { color: tone } : undefined}>
        {value == null ? '-' : <AnimatedNumber value={value} suffix={unit} />}
      </div>
    </div>
  );
}

function AccountCardInner({ acc, state, uptime, syncText, latency, isAdmin, onDelete, onCopyJob }: Props) {
  const name = acc.displayName || acc.username;
  const avatar = safeImageUrl(acc.avatarUrl);
  const color = STATE_COLOR[state];
  return (
    <motion.article layout="position" initial={{ opacity: 0, y: 14, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.94 }} whileHover={{ y: -3 }} transition={{ type: 'spring', stiffness: 420, damping: 34 }}
      className="glass glass-hover relative flex flex-col gap-3 overflow-hidden p-4">
      {/* Garis tipis menyala tiap heartbeat baru (key = lastUpdate). */}
      <motion.span key={acc.lastUpdate} className="absolute inset-x-0 top-0 h-0.5 origin-left" style={{ background: color }} initial={{ opacity: 0.9, scaleX: 1 }} animate={{ opacity: 0, scaleX: 0.2 }} transition={{ duration: 1.1, ease: 'easeOut' }} aria-hidden />
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid size-10 flex-none place-items-center overflow-hidden rounded-full bg-gradient-to-br from-cyan-400/30 to-violet-500/30 text-sm font-bold text-white" aria-hidden>
            {avatar ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={avatar} alt="" referrerPolicy="no-referrer" loading="lazy" className="size-full object-cover" /> : name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0"><div className="truncate font-semibold text-white">{name}</div><div className="truncate text-xs text-amber-300/80">@{acc.username}</div></div>
        </div>
        <StatusPill state={state} />
      </div>

      <div className="space-y-1.5 text-sm">
        <div className="flex items-center justify-between gap-2"><span className="truncate text-slate-300"><span className="text-slate-500">Game:</span> {acc.gameName || '-'}</span><b className="tabular flex-none" style={{ color }}>Aktif {uptime}</b></div>
        <div className="truncate font-mono text-xs text-slate-500">Job ID: {acc.jobId || 'Local/Private'}</div>
        <div className="flex items-center justify-between text-xs text-slate-400"><span>User ID: {acc.userId || '-'}</span><span>Latensi: <AnimatedNumber value={acc.latencyMs} suffix="ms" /></span></div>
      </div>

      {state !== 'OFFLINE' && (acc.fps != null || acc.pingMs != null || acc.memoryMb != null) && (
        <div className="grid grid-cols-3 gap-2 text-center" aria-label="Telemetri klien">
          <Metric label="FPS" value={acc.fps} unit="" tone={acc.fps == null ? undefined : acc.fps >= 50 ? '#34d399' : acc.fps >= 30 ? '#fbbf24' : '#f87171'} />
          <Metric label="Ping" value={acc.pingMs} unit="ms" tone={acc.pingMs == null ? undefined : acc.pingMs < 150 ? '#34d399' : acc.pingMs < 400 ? '#fbbf24' : '#f87171'} />
          <Metric label="Memori" value={acc.memoryMb} unit="MB" />
        </div>
      )}

      <div><div className="mb-0.5 text-[11px] text-slate-500">Tren latensi</div><Sparkline values={latency} color={color} label={`Latensi ${acc.username}`} /></div>

      <div className="mt-auto flex items-center justify-between gap-2 text-xs text-slate-500">
        <span>Sync: {syncText}</span>
        <span className="flex gap-1.5">
          {acc.jobId && <Button size="sm" onClick={() => onCopyJob(acc)}><Copy className="size-3.5" />Job ID</Button>}
          {isAdmin && <Button size="sm" variant="danger" onClick={() => onDelete(acc)} aria-label={`Hapus akun ${acc.username}`}><Trash2 className="size-3.5" /></Button>}
        </span>
      </div>
    </motion.article>
  );
}
export const AccountCard = memo(AccountCardInner);
