'use client';
import { motion } from 'motion/react';
import { ArrowRight, Radar } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { useI18n } from '@/components/i18n/I18nProvider';
import { Button } from '@/components/ui/Button';
import { EASE_OUT } from '@/components/motion/variants';
import { fill, getCopy } from '@/components/onboarding/copy';

const BLOBS = [
  { c: 'bg-cyan-400/30', s: 'size-[34rem] -left-40 -top-40', x: [0, 90, -30, 0], y: [0, 60, 120, 0], d: 22 },
  { c: 'bg-violet-500/30', s: 'size-[38rem] -right-48 top-10', x: [0, -80, 40, 0], y: [0, 100, -40, 0], d: 26 },
  { c: 'bg-emerald-400/20', s: 'size-[28rem] left-1/3 -bottom-48', x: [0, 70, -60, 0], y: [0, -70, 20, 0], d: 30 },
];

export function WelcomeScreen({ username, onEnter }: { username: string; onEnter: () => void }) {
  const { locale } = useI18n();
  const c = getCopy(locale);
  const dots = useMemo(() => Array.from({ length: 22 }, (_, i) => ({ left: (i * 47) % 100, top: (i * 29 + 11) % 100, delay: (i % 7) * 0.6, dur: 5 + (i % 5) })), []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Enter') onEnter(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onEnter]);

  return (
    <motion.div className="fixed inset-0 z-[60] grid place-items-center overflow-hidden bg-ink p-6" initial={{ opacity: 1 }} exit={{ opacity: 0, scale: 1.03, transition: { duration: 0.45, ease: 'easeIn' } }} role="dialog" aria-modal="true" aria-label={fill(c.title, { name: username })}>
      {/* Latar: blob aurora + grid + partikel (hanya transform/opacity) */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        {BLOBS.map((b, i) => <motion.div key={i} className={`absolute rounded-full blur-3xl ${b.c} ${b.s}`} animate={{ x: b.x, y: b.y }} transition={{ duration: b.d, repeat: Infinity, ease: 'easeInOut' }} />)}
        <div className="absolute inset-0 opacity-[0.07] [background-image:linear-gradient(white_1px,transparent_1px),linear-gradient(90deg,white_1px,transparent_1px)] [background-size:48px_48px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)]" />
        {dots.map((d, i) => <motion.span key={i} className="absolute size-1 rounded-full bg-cyan-200/70" style={{ left: `${d.left}%`, top: `${d.top}%` }} animate={{ y: [0, -28, 0], opacity: [0, 0.9, 0] }} transition={{ duration: d.dur, delay: d.delay, repeat: Infinity, ease: 'easeInOut' }} />)}
      </div>

      <motion.div className="relative z-10 flex max-w-xl flex-col items-center text-center" initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.12, delayChildren: 0.15 } } }}>
        {[
          <span key="logo" className="relative grid size-16 place-items-center rounded-2xl border border-cyan-300/30 bg-cyan-300/10 text-cyan-200 shadow-[0_0_48px_-6px_rgb(34_211_238/0.8)]">
            <motion.span aria-hidden className="absolute inset-0 rounded-2xl border border-cyan-300/40" animate={{ scale: [1, 1.5], opacity: [0.6, 0] }} transition={{ duration: 2.2, repeat: Infinity, ease: 'easeOut' }} />
            <Radar className="size-8" aria-hidden />
          </span>,
          <span key="badge" className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-xs tracking-wide text-slate-300">{c.badge}</span>,
          <h1 key="title" className="glow-text bg-gradient-to-r from-white via-cyan-200 to-violet-300 bg-clip-text text-4xl font-semibold text-transparent sm:text-5xl">{fill(c.title, { name: username })}</h1>,
          <p key="sub" className="max-w-md text-base text-slate-300">{c.subtitle}</p>,
          <div key="chips" className="flex flex-wrap justify-center gap-2">{c.features.map((f) => <span key={f} className="rounded-full border border-cyan-300/20 bg-cyan-300/[0.07] px-3 py-1 text-xs text-cyan-100">{f}</span>)}</div>,
          <div key="cta" className="flex flex-col items-center gap-2">
            <Button variant="primary" onClick={onEnter} autoFocus className="px-6 py-3 text-base">{c.enter}<ArrowRight className="size-4" aria-hidden /></Button>
            <span className="text-xs text-slate-500">{c.hint}</span>
          </div>,
        ].map((el, i) => <motion.div key={i} className="mb-5 last:mb-0" variants={{ hidden: { opacity: 0, y: 18 }, show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE_OUT } } }}>{el}</motion.div>)}
      </motion.div>
    </motion.div>
  );
}
