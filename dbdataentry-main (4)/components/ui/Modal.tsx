'use client';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';

export function useEscape(active: boolean, onClose: () => void) {
  useEffect(() => {
    if (!active) return undefined;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [active, onClose]);
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const id = useId();
  useEscape(open, onClose);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
          <motion.div role="dialog" aria-modal="true" aria-labelledby={id} className={`glass w-full ${wide ? 'max-w-2xl' : 'max-w-md'} p-6`} initial={{ opacity: 0, y: 16, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.98 }} transition={{ type: 'spring', stiffness: 420, damping: 32 }}>
            <h3 id={id} className="mb-3 text-lg font-semibold text-white">{title}</h3>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export interface ConfirmState { title: string; message: string; confirmLabel?: string; danger?: boolean; onConfirm: () => void }

export function ConfirmDialog({ dialog, onClose }: { dialog: ConfirmState | null; onClose: () => void }) {
  const last = useRef<ConfirmState | null>(null);
  if (dialog) last.current = dialog;
  const d = dialog ?? last.current;
  return (
    <Modal open={Boolean(dialog)} onClose={onClose} title={d?.title ?? ''}>
      <p className="mb-5 text-sm leading-relaxed text-slate-300">{d?.message}</p>
      <div className="flex justify-end gap-2">
        <Button onClick={onClose} autoFocus>Batal</Button>
        <Button variant={d?.danger ? 'danger' : 'primary'} onClick={() => { onClose(); d?.onConfirm(); }}>{d?.confirmLabel ?? 'Ya, lanjutkan'}</Button>
      </div>
    </Modal>
  );
}

// Dialog satu input teks (buat / ganti nama tabel).
export function NameDialog({ open, title, label, initial, submitLabel, onClose, onSubmit }: { open: boolean; title: string; label: string; initial: string; submitLabel: string; onClose: () => void; onSubmit: (name: string) => Promise<void> }) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (open) { setValue(initial); setError(''); } }, [open, initial]);
  const id = useId();

  const submit = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try { await onSubmit(value); onClose(); } catch (err) { setError(err instanceof Error ? err.message : 'Gagal'); } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor={id} className="mb-1.5 block text-xs font-medium text-slate-400">{label}</label>
          <input id={id} className="field" value={value} onChange={(e) => setValue(e.target.value)} maxLength={64} autoFocus required minLength={2} />
          {error && <p role="alert" className="mt-2 text-xs text-rose-300">{error}</p>}
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>Batal</Button>
          <Button type="submit" variant="primary" disabled={busy}>{busy ? 'Menyimpan…' : submitLabel}</Button>
        </div>
      </form>
    </Modal>
  );
}
