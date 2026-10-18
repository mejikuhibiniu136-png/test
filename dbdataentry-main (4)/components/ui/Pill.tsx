'use client';
import { AnimatePresence, motion } from 'motion/react';
import type { ReactNode } from 'react';
import type { AccountState } from '@/lib/accounts';

const TONES = {
  neutral: 'border-white/10 bg-white/[0.05] text-slate-300',
  ok: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300',
  warn: 'border-amber-400/30 bg-amber-400/10 text-amber-300',
  bad: 'border-rose-400/30 bg-rose-400/10 text-rose-300',
  accent: 'border-cyan-300/30 bg-cyan-300/10 text-cyan-200',
  violet: 'border-violet-400/30 bg-violet-400/10 text-violet-200',
} as const;
export type Tone = keyof typeof TONES;

export function Pill({ tone = 'neutral', children, dot, className = '' }: { tone?: Tone; children: ReactNode; dot?: 'live' | 'static'; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${TONES[tone]} ${className}`}>
      {dot && <span className={`size-1.5 rounded-full bg-current ${dot === 'live' ? 'animate-pulse-dot' : ''}`} />}
      {children}
    </span>
  );
}

export const STATE_TONE: Record<AccountState, Tone> = { ONLINE: 'ok', STALLED: 'warn', OFFLINE: 'bad' };
export const STATE_COLOR: Record<AccountState, string> = { ONLINE: '#34d399', STALLED: '#fbbf24', OFFLINE: '#fb7185' };

// Label status bertukar dengan crossfade; titik berdenyut hanya saat ONLINE.
export function StatusPill({ state }: { state: AccountState }) {
  return (
    <Pill tone={STATE_TONE[state]}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={state} className="inline-flex items-center gap-1.5" initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }} transition={{ duration: 0.15 }}>
          <span className={`size-1.5 rounded-full bg-current ${state === 'ONLINE' ? 'animate-pulse-dot' : ''}`} />
          {state}
        </motion.span>
      </AnimatePresence>
    </Pill>
  );
}
