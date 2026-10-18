'use client';
import { AnimatePresence, motion } from 'motion/react';
import { Check, Globe } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useI18n } from '@/components/i18n/I18nProvider';
import { LOCALES, LOCALE_NAMES, type Locale } from '@/lib/i18n/config';

// Dropdown pemilih bahasa: tombol + listbox. Keyboard: Enter/Space/↓ buka, ↑↓ pindah, Enter pilih,
// Esc/Tab/klik di luar menutup. `compact` = hanya ikon + kode (bilah mobile / header sempit).
export function LanguageSwitcher({ compact = false, align = 'left', dropUp = false }: { compact?: boolean; align?: 'left' | 'right'; dropUp?: boolean }) {
  const { locale, setLocale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const choose = (l: Locale) => { setOpen(false); button.current?.focus(); void setLocale(l); };
  const openMenu = () => { setActive(Math.max(0, LOCALES.indexOf(locale))); setOpen(true); };

  const onKey = (e: React.KeyboardEvent) => {
    if (!open) { if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(e.key)) { e.preventDefault(); openMenu(); } return; }
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false); button.current?.focus(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % LOCALES.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i - 1 + LOCALES.length) % LOCALES.length); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
    else if (e.key === 'End') { e.preventDefault(); setActive(LOCALES.length - 1); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(LOCALES[active]); }
    else if (e.key === 'Tab') setOpen(false);
  };

  return (
    <div ref={root} className="relative" onKeyDown={onKey}>
      <button ref={button} type="button" aria-haspopup="listbox" aria-expanded={open} aria-controls={listId} aria-label={`${t('lang.label')}: ${LOCALE_NAMES[locale].native}`}
        onClick={() => (open ? setOpen(false) : openMenu())}
        className="flex min-h-9 cursor-pointer items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-xs text-slate-300 transition-colors hover:border-cyan-300/30 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300/60">
        <Globe className="size-4" aria-hidden />
        <span className="font-medium">{compact ? LOCALE_NAMES[locale].short : LOCALE_NAMES[locale].native}</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.ul id={listId} role="listbox" aria-label={t('lang.choose')} aria-activedescendant={`${listId}-${LOCALES[active]}`} tabIndex={-1}
            initial={{ opacity: 0, y: dropUp ? 6 : -6, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: dropUp ? 6 : -6, scale: 0.97 }} transition={{ type: 'spring', stiffness: 520, damping: 34 }}
            className={`glass absolute z-50 min-w-44 overflow-hidden p-1 ${dropUp ? 'bottom-full mb-2' : 'top-full mt-2'} ${align === 'right' ? 'right-0 origin-top-right' : 'left-0 origin-top-left'}`}>
            {LOCALES.map((l, i) => (
              <li key={l} id={`${listId}-${l}`} role="option" aria-selected={l === locale} lang={l} onMouseEnter={() => setActive(i)} onClick={() => choose(l)}
                className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm ${i === active ? 'bg-cyan-300/10 text-white' : 'text-slate-300'}`}>
                <span>{LOCALE_NAMES[l].native}</span>{l === locale && <Check className="size-4 text-cyan-300" aria-hidden />}
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
