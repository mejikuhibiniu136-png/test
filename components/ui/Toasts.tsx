'use client';
import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle2, Info, TriangleAlert } from 'lucide-react';
import type { Toast } from '@/lib/client';

const ICON = { success: CheckCircle2, error: TriangleAlert, info: Info };
const TONE = { success: 'border-emerald-400/30 text-emerald-200', error: 'border-rose-400/30 text-rose-200', info: 'border-cyan-300/30 text-cyan-100' };

export function Toasts({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2" role="status" aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((t) => {
          const Icon = ICON[t.type];
          return (
            <motion.div key={t.id} layout initial={{ opacity: 0, x: 40, scale: 0.96 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={{ opacity: 0, x: 40, scale: 0.96, transition: { duration: 0.18 } }} transition={{ type: 'spring', stiffness: 500, damping: 34 }}
              className={`glass pointer-events-auto relative flex items-start gap-2.5 overflow-hidden px-4 py-3 text-sm ${TONE[t.type]}`}>
              <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span className="text-slate-100">{t.message}</span>
              <motion.span className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-current opacity-60" initial={{ scaleX: 1 }} animate={{ scaleX: 0 }} transition={{ duration: 4, ease: 'linear' }} aria-hidden />
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
