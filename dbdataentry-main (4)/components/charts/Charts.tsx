'use client';
import { motion } from 'motion/react';
import type { Activity } from '@/lib/logStats';

// Batang tumbuh dari garis dasar: transform-box fill-box membuat asal skala di tepi bawah batang itu sendiri.
const BAR_STYLE = { transformBox: 'fill-box', transformOrigin: 'bottom' } as const;

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function Sparkline({ values, color = '#22d3ee', label }: { values: number[]; color?: string; label: string }) {
  const data = values.map(num);
  const W = 120, H = 34, pad = 3;
  if (!data.length) {
    return <svg className="h-8 w-full" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label}: belum ada data`}><line x1="0" y1={H / 2} x2={W} y2={H / 2} stroke="rgb(255 255 255 / 0.15)" strokeDasharray="3 4" /></svg>;
  }
  const min = Math.min(...data), max = Math.max(...data), range = max - min || 1;
  const step = data.length > 1 ? (W - pad * 2) / (data.length - 1) : 0;
  const pts = data.map((v, i) => [data.length > 1 ? pad + i * step : W / 2, H - pad - ((v - min) / range) * (H - pad * 2)]);
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg className="h-8 w-full" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${label}: terakhir ${data[data.length - 1]} ms, rentang ${min}-${max} ms`}>
      {data.length > 1 && <motion.polyline initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }} points={pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />}
      <path d={`M${lx.toFixed(1)} ${ly.toFixed(1)}h0.001`} stroke={color} strokeWidth="6" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

const fmtTime = (ms: number, withDay = false) =>
  withDay ? new Date(ms).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const fmtSpan = (ms: number) => { const h = Math.round(ms / 3_600_000); return h >= 1 ? `${h} jam` : `${Math.max(1, Math.round(ms / 60_000))} menit`; };

export function ActivityChart({ data }: { data: Activity }) {
  const b = data.buckets;
  if (!b.length) return <div className="grid h-40 place-items-center text-sm text-slate-500">Belum ada aktivitas untuk digrafikkan.</div>;
  if (data.max === 0) return <div className="grid h-40 place-items-center text-center text-sm text-slate-500">Tidak ada aktivitas dalam {fmtSpan(data.spanMs)} terakhir.</div>;

  const W = 960, H = 210, padL = 28, padB = 22, padT = 8;
  const innerW = W - padL - 6, innerH = H - padB - padT;
  const max = Math.max(data.max, 1), slot = innerW / b.length, barW = Math.max(2, slot - 3);
  const withDay = data.spanMs >= 12 * 3_600_000;
  return (
    <div>
      <svg className="h-auto w-full" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Grafik aktivitas, puncak ${data.max} event per ${Math.round(data.bucketMs / 60_000) || 1} menit`}>
        {[0, 0.5, 1].map((g) => {
          const y = padT + innerH - g * innerH;
          return <g key={g}><line x1={padL} x2={W - 6} y1={y} y2={y} stroke="rgb(255 255 255 / 0.08)" /><text x={padL - 6} y={y + 3} textAnchor="end" fontSize="10" fill="#64748b">{Math.round(max * g)}</text></g>;
        })}
        {b.map((bk, i) => {
          const x = padL + i * slot + (slot - barW) / 2;
          const hO = (bk.other / max) * innerH, hH = (bk.heartbeat / max) * innerH;
          const yO = padT + innerH - hO, yH = yO - hH;
          return (
            <g key={bk.start}>
              <title>{`${fmtTime(bk.start)} • ${bk.other} event, ${bk.heartbeat} heartbeat`}</title>
              {bk.heartbeat > 0 && <motion.rect x={x} y={yH} width={barW} height={hH} rx="2" fill="#22d3ee" style={BAR_STYLE} initial={{ scaleY: 0, opacity: 0 }} animate={{ scaleY: 1, opacity: 0.35 }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1], delay: Math.min(i, 60) * 0.012 }} />}
              {bk.other > 0 && <motion.rect x={x} y={yO} width={barW} height={hO} rx="2" fill="#8b5cf6" style={BAR_STYLE} initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1], delay: Math.min(i, 60) * 0.012 }} />}
            </g>
          );
        })}
        <text x={padL} y={H - 6} fontSize="10" fill="#64748b">{fmtTime(b[0].start, withDay)}</text>
        <text x={W - 6} y={H - 6} textAnchor="end" fontSize="10" fill="#64748b">{fmtTime(b[b.length - 1].start + data.bucketMs, withDay)}</text>
      </svg>
      <div className="mt-2 flex gap-4 text-xs text-slate-400">
        <span className="inline-flex items-center gap-1.5"><i className="size-2 rounded-full bg-violet-500" />Event</span>
        <span className="inline-flex items-center gap-1.5"><i className="size-2 rounded-full bg-cyan-400/50" />Heartbeat</span>
      </div>
    </div>
  );
}

export function BarList({ items, empty = 'Belum ada data.' }: { items: { name: string; count: number }[]; empty?: string }) {
  if (!items.length) return <p className="text-sm text-slate-500">{empty}</p>;
  const max = Math.max(...items.map((i) => num(i.count)), 1);
  return (
    <div className="space-y-2.5">
      {items.map((it) => (
        <div key={it.name} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-sm">
          <span className="truncate text-slate-300" title={it.name}>{it.name}</span>
          <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]" aria-hidden>
            <div className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-violet-500 transition-[width] duration-500" style={{ width: `${Math.max(3, (num(it.count) / max) * 100)}%` }} />
          </div>
          <b className="tabular text-slate-100">{it.count.toLocaleString('id-ID')}</b>
        </div>
      ))}
    </div>
  );
}
