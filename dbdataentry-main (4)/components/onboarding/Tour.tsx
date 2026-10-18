'use client';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useI18n } from '@/components/i18n/I18nProvider';
import { Button } from '@/components/ui/Button';
import { fill, getCopy } from '@/components/onboarding/copy';
import { SPRING } from '@/components/motion/variants';

const PAD = 8;
const CARD_W = 340;
// Sidebar desktop dan bar bawah mobile memakai data-tour yang sama; ambil yang sedang tampil.
const findVisible = (id: string) => Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${id}"]`)).find((el) => el.getClientRects().length > 0) ?? null;

export function Tour({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { locale } = useI18n();
  const c = getCopy(locale);
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [vp, setVp] = useState({ w: 0, h: 0 });
  const cardRef = useRef<HTMLDivElement>(null);
  const step = c.steps[i];
  const last = i === c.steps.length - 1;

  useEffect(() => { if (open) setI(0); }, [open]);

  const measure = useCallback(() => {
    setVp({ w: window.innerWidth, h: window.innerHeight });
    const el = step?.target ? findVisible(step.target) : null;
    setRect(el ? el.getBoundingClientRect() : null);
  }, [step]);

  useLayoutEffect(() => {
    if (!open) return undefined;
    const el = step?.target ? findVisible(step.target) : null;
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    measure();
    const t = setTimeout(measure, 350); // setelah scroll halus selesai
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => { clearTimeout(t); window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true); };
  }, [open, step, measure]);

  const go = useCallback((d: number) => { if (d > 0 && last) onClose(); else setI((n) => Math.min(Math.max(n + d, 0), c.steps.length - 1)); }, [last, onClose, c.steps.length]);

  useEffect(() => {
    if (!open) return undefined;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') go(1); // Enter ditangani tombol yang sedang fokus
      else if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, go, onClose]);

  // Posisi kartu: di bawah target bila muat, kalau tidak di atasnya; tanpa target = tengah layar.
  const cardH = cardRef.current?.offsetHeight ?? 200;
  const w = Math.min(CARD_W, vp.w - 24);
  let left = Math.max(12, (vp.w - w) / 2), top = Math.max(12, (vp.h - cardH) / 2);
  if (rect) {
    left = Math.min(Math.max(12, rect.left), vp.w - w - 12);
    const below = rect.bottom + PAD + 12;
    top = below + cardH <= vp.h - 12 ? below : rect.top - PAD - 12 - cardH;
    top = Math.min(Math.max(12, top), vp.h - cardH - 12); // target sangat tinggi: kartu tetap di dalam layar
  }

  return (
    <AnimatePresence>
      {open && vp.w > 0 && (
        <motion.div className="fixed inset-0 z-[70]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} role="dialog" aria-modal="true" aria-label={c.tourLabel}>
          {/* Penahan klik + sorotan: bayangan raksasa menggelapkan sisanya */}
          {/* penahan klik: klik di area gelap tidak menutup tur */}
          <div className="absolute inset-0" />
          <motion.div aria-hidden className="pointer-events-none absolute rounded-2xl border border-cyan-300/60 shadow-[0_0_0_9999px_rgb(3_6_12/0.72),0_0_32px_rgb(34_211_238/0.35)]"
            initial={false} animate={rect ? { top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2, opacity: 1 } : { top: vp.h / 2, left: vp.w / 2, width: 0, height: 0, opacity: 1 }} transition={SPRING} />
          <motion.div ref={cardRef} className="glass absolute p-5" style={{ width: w }} initial={false} animate={{ top, left }} transition={SPRING}>
            <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-cyan-300">{fill(c.step, { current: i + 1, total: c.steps.length })}</div>
            <h3 className="mb-1.5 text-lg font-semibold text-white">{step.title}</h3>
            <p className="mb-4 text-sm leading-relaxed text-slate-300">{step.body}</p>
            <div className="flex items-center justify-between gap-2">
              <div className="flex gap-1" aria-hidden>{c.steps.map((_, n) => <span key={n} className={`h-1.5 rounded-full transition-all ${n === i ? 'w-5 bg-cyan-300' : 'w-1.5 bg-white/20'}`} />)}</div>
              <div className="flex gap-2">
                {!last && <Button size="sm" variant="subtle" onClick={onClose}>{c.skip}</Button>}
                {i > 0 && <Button size="sm" onClick={() => go(-1)}>{c.prev}</Button>}
                <Button size="sm" variant="primary" onClick={() => go(1)} autoFocus>{last ? c.done : c.next}</Button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
