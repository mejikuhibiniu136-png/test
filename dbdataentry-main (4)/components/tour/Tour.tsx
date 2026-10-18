'use client';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { useI18n } from '@/components/i18n/I18nProvider';
import { Button } from '@/components/ui/Button';
import type { MessageKey } from '@/lib/i18n/dictionaries/en';

export const TOUR_STORAGE_KEY = 'dbde_tour_done_v1';

// `target` = nilai atribut data-tour di elemen dashboard. Tanpa target = kartu di tengah layar.
interface Step { target?: string; title: MessageKey; body: MessageKey }
const STEPS: Step[] = [
  { title: 'tour.s1.title', body: 'tour.s1.body' },
  { target: 'nav', title: 'tour.s2.title', body: 'tour.s2.body' },
  { target: 'status', title: 'tour.s3.title', body: 'tour.s3.body' },
  { target: 'tables', title: 'tour.s4.title', body: 'tour.s4.body' },
  { target: 'content', title: 'tour.s5.title', body: 'tour.s5.body' },
  { target: 'controls', title: 'tour.s6.title', body: 'tour.s6.body' },
];

const PAD = 6;
const CARD_W = 352;

// Elemen yang sama bisa ada dua (sidebar desktop vs bar bawah mobile): ambil yang benar-benar terlihat.
const findTarget = (name?: string) =>
  name ? [...document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`)].find((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }) ?? null : null;

function place(rect: DOMRect): CSSProperties {
  const vw = window.innerWidth, vh = window.innerHeight, w = Math.min(CARD_W, vw - 32);
  const left = Math.min(Math.max(16, rect.left), vw - w - 16);
  if (rect.height > vh * 0.6) // target tinggi (sidebar/konten): di sisi kanan bila muat, kalau tidak di bawah layar
    return vw - rect.right > w + 32 ? { left: rect.right + 16, top: 24, width: w } : { left: (vw - w) / 2, bottom: 16, width: w };
  return rect.top + rect.height / 2 > vh / 2 ? { left, bottom: vh - rect.top + PAD + 12, width: w } : { left, top: rect.bottom + PAD + 12, width: w };
}

export function Tour({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const [steps, setSteps] = useState<Step[]>([]);
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const step = steps[i];

  // Langkah yang targetnya tidak ada di layar saat ini (mis. tab tabel di menu lain) dilewati.
  useEffect(() => { if (open) { setSteps(STEPS.filter((s) => !s.target || findTarget(s.target))); setI(0); } }, [open]);

  const measure = useCallback(() => setRect(findTarget(step?.target)?.getBoundingClientRect() ?? null), [step]);
  useEffect(() => {
    if (!open || !step) return;
    findTarget(step.target)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    measure();
    const timer = setTimeout(measure, 350); // ukur ulang setelah scroll halus selesai
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => { clearTimeout(timer); window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true); };
  }, [open, step, measure]);

  const finish = useCallback(() => { try { localStorage.setItem(TOUR_STORAGE_KEY, '1'); } catch { /* mode privat */ } onClose(); }, [onClose]);
  const last = i === steps.length - 1;
  const next = useCallback(() => (last ? finish() : setI((n) => n + 1)), [last, finish]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') setI((n) => Math.max(0, n - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, finish, next]);

  if (!open || !step) return null;

  const card = (
    <motion.div key={i} role="dialog" aria-modal="true" aria-labelledby="tour-title" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
      className="glass w-full max-w-[22rem] bg-slate-900/90 p-4 shadow-2xl">
      <div className="mb-1 flex items-center justify-between text-[11px] text-slate-400">
        <span className="tabular">{t('tour.step', { current: i + 1, total: steps.length })}</span>
        <button onClick={finish} className="cursor-pointer rounded px-1 hover:text-white">{t('tour.skip')}</button>
      </div>
      <h2 id="tour-title" className="text-base font-semibold text-white">{t(step.title)}</h2>
      <p className="mt-1 text-sm text-slate-300">{t(step.body)}</p>
      <div className="mt-4 flex items-center justify-between">
        <div className="flex gap-1" aria-hidden>{steps.map((_, n) => <span key={n} className={`h-1.5 rounded-full transition-all ${n === i ? 'w-5 bg-cyan-300' : 'w-1.5 bg-white/20'}`} />)}</div>
        <div className="flex gap-2">
          {i > 0 && <Button size="sm" onClick={() => setI(i - 1)}>{t('tour.back')}</Button>}
          <Button size="sm" variant="primary" autoFocus onClick={next}>{last ? t('tour.done') : t('tour.next')}</Button>
        </div>
      </div>
    </motion.div>
  );

  return (
    <div className="fixed inset-0 z-[100]">
      {/* Penangkap klik: dashboard di belakang tidak bisa disentuh selama tur. Tanpa target, latar digelapkan penuh. */}
      <div className={`absolute inset-0 ${rect ? '' : 'bg-[#03060e]/75 backdrop-blur-sm'}`} />
      {rect && (
        <motion.div initial={false} animate={{ top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }} transition={{ type: 'spring', stiffness: 260, damping: 30 }}
          className="pointer-events-none fixed rounded-2xl border border-cyan-300/60 shadow-[0_0_0_9999px_rgb(3_6_14/0.72),0_0_32px_rgb(34_211_238/0.35)]" />
      )}
      {rect
        ? <div className="fixed" style={place(rect)}><AnimatePresence mode="wait">{card}</AnimatePresence></div>
        : <div className="fixed inset-0 grid place-items-center p-4"><AnimatePresence mode="wait">{card}</AnimatePresence></div>}
    </div>
  );
}
