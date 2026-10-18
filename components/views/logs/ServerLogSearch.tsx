'use client';
import { AnimatePresence } from 'motion/react';
import { Download, Search, X } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { useI18n } from '@/components/i18n/I18nProvider';
import { LogBoundary, LogCard } from '@/components/tables/LogList';
import { Button } from '@/components/ui/Button';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { apiJson } from '@/lib/client';
import type { SearchResult } from '@/lib/logSearch';
import type { LogEntry } from '@/types';

interface Props { gameSlug: string; gameLabel: string; showGame: boolean; copiedId: string | null; onOpen: (l: LogEntry) => void; onCopy: (l: LogEntry) => void; toast: (m: string, t?: 'success' | 'error' | 'info') => void }

// Pencarian full-text di SERVER: menjangkau seluruh log tersimpan (bukan hanya yang dimuat di layar),
// dengan filter tanggal, paginasi kursor, dan ekspor yang memakai filter yang sama.
export function ServerLogSearch({ gameSlug, gameLabel, showGame, copiedId, onOpen, onCopy, toast }: Props) {
  const { t, n } = useI18n();
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [rows, setRows] = useState<LogEntry[] | null>(null);
  const [meta, setMeta] = useState<Pick<SearchResult, 'matched' | 'scanned' | 'truncated'> | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  const params = (extra: Record<string, string> = {}) => {
    const p = new URLSearchParams({ game: gameSlug, ...extra });
    if (q.trim()) p.set('q', q.trim());
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    return p;
  };

  const run = useCallback(async (more = false) => {
    const mine = ++seq.current; // permintaan lama yang selesai belakangan tidak boleh menimpa hasil baru
    setBusy(true);
    try {
      const res = await apiJson<SearchResult>(`/api/logs/search?${params({ limit: '50', ...(more && cursor ? { cursor } : {}) })}`, 'GET');
      if (mine !== seq.current) return;
      setRows((cur) => (more && cur ? [...cur, ...res.data] : res.data));
      setMeta({ matched: res.matched, scanned: res.scanned, truncated: res.truncated });
      setCursor(res.nextCursor);
    } catch (e) { if (mine === seq.current) toast(e instanceof Error ? e.message : t('common.error'), 'error'); } finally { if (mine === seq.current) setBusy(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, from, to, gameSlug, cursor, toast, t]);

  const reset = () => { seq.current += 1; setQ(''); setFrom(''); setTo(''); setRows(null); setMeta(null); setCursor(null); setBusy(false); };
  const exportUrl = (format: 'csv' | 'json' | 'ndjson') => `/api/logs/export?${params({ format })}`;

  return (
    <div className="space-y-4">
      <form className="glass flex flex-wrap items-end gap-3 p-3" onSubmit={(e) => { e.preventDefault(); setCursor(null); void run(false); }}>
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-500" aria-hidden />
          <input className="field pl-9" aria-label={t('common.search')} placeholder={t('logs.searchPlaceholder')} value={q} onChange={(e) => setQ(e.target.value)} maxLength={500} />
        </div>
        <label className="text-xs text-slate-400"><span className="mb-1 block">{t('common.from')}</span><input type="date" className="field py-1.5 text-xs" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="text-xs text-slate-400"><span className="mb-1 block">{t('common.to')}</span><input type="date" className="field py-1.5 text-xs" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></label>
        <Button type="submit" variant="primary" disabled={busy}>{t('common.search')}</Button>
        <Button type="button" onClick={reset}><X className="size-3.5" aria-hidden />{t('common.clear')}</Button>
        <p className="basis-full text-[11px] text-slate-500">{t('logs.syntax')}</p>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-400">
        <span>{meta ? `${t('logs.results', { count: n(meta.matched) })} · ${t('logs.scanned', { count: n(meta.scanned) })} · ${gameLabel}` : gameLabel}{meta?.truncated && <span className="ml-2 text-amber-300">{t('logs.truncated')}</span>}</span>
        <div className="flex flex-wrap gap-2">
          {(['csv', 'json', 'ndjson'] as const).map((f) => (
            <Button key={f} size="sm" onClick={() => window.location.assign(exportUrl(f))}><Download className="size-3.5" aria-hidden />{t(`logs.export${f === 'csv' ? 'Csv' : f === 'json' ? 'Json' : 'Ndjson'}` as 'logs.exportCsv')}</Button>
          ))}
        </div>
      </div>

      {busy && rows === null ? <SkeletonRows /> : rows !== null && rows.length === 0 ? (
        <div className="glass p-10 text-center text-sm text-slate-500">{t('logs.noMatches')}</div>
      ) : rows !== null && (
        <div className="space-y-3">
          <AnimatePresence initial={false}>
            {rows.map((log) => <LogBoundary key={log.id}><LogCard log={log} isNew={false} copied={copiedId === log.id} showGame={showGame} onOpen={onOpen} onCopy={onCopy} /></LogBoundary>)}
          </AnimatePresence>
          {cursor && <div className="text-center"><Button disabled={busy} onClick={() => void run(true)}>{busy ? t('common.loading') : t('common.loadMore')}</Button></div>}
        </div>
      )}
    </div>
  );
}
