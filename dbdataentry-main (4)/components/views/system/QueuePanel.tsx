'use client';
import { Layers } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '@/components/i18n/I18nProvider';
import { AnimatedNumber } from '@/components/ui/AnimatedNumber';
import { Button } from '@/components/ui/Button';
import { Explainer } from '@/components/ui/Explainer';
import { Pill } from '@/components/ui/Pill';
import { Skeleton } from '@/components/ui/Skeleton';
import { apiJson } from '@/lib/client';
import { formatRelative } from '@/lib/i18n/format';
import type { QueueStats } from '@/lib/ingest/queue';

interface Payload { enabled: boolean; stats: QueueStats; limits: { maxDepth: number; maxItemBytes: number; maxAttempts: number; leaseSeconds: number } }
type Notify = (m: string, t?: 'success' | 'error' | 'info') => void;

export function QueuePanel({ toast, enabled, busy, onToggle }: { toast: Notify; enabled: boolean; busy: boolean; onToggle: (v: boolean) => void }) {
  const { t, n, locale } = useI18n();
  const [data, setData] = useState<Payload | null>(null);
  const [working, setWorking] = useState(false);

  const load = useCallback(async () => {
    try { setData(await apiJson<Payload>('/api/admin/queue', 'GET')); } catch { /* polling: galat sesaat tidak perlu toast */ }
  }, []);
  useEffect(() => {
    void load();
    const id = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 5000);
    return () => clearInterval(id);
  }, [load]);

  const act = async (action: 'drain' | 'retry-dead' | 'purge-dead') => {
    setWorking(true);
    try { const r = await apiJson<Payload & { message?: string }>('/api/admin/queue', 'POST', { action }); setData(r); toast(r.message ?? 'OK', 'success'); } catch (e) { toast(e instanceof Error ? e.message : t('common.error'), 'error'); } finally { setWorking(false); }
  };

  const s = data?.stats;
  const tile = (label: string, value: number, tone = 'text-white') => (
    <div className="rounded-xl border border-white/10 bg-black/20 p-3"><div className="text-[11px] text-slate-500">{label}</div><div className={`mt-1 text-2xl font-semibold ${tone}`}><AnimatedNumber value={value} /></div></div>
  );

  return (
    <section className="glass p-5" aria-labelledby="queue-title">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="queue-title" className="flex items-center gap-2 text-sm font-semibold text-white"><Layers className="size-4 text-violet-300" aria-hidden />{t('queue.title')}</h3>
          <p className="mt-1 text-xs text-slate-500">{t('queue.subtitle')}</p>
        </div>
        <Pill tone={enabled ? 'ok' : 'neutral'} dot={enabled ? 'live' : 'static'}>{enabled ? t('common.enabled') : t('common.disabled')}</Pill>
      </div>

      <label className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-white/10 bg-black/20 px-4 py-3">
        <span><span className="block text-sm text-slate-200">{t('queue.mode')}</span><span className="mt-0.5 block text-xs text-slate-500">{t('queue.modeHint')}</span></span>
        <input type="checkbox" className="mt-1 size-4 flex-none accent-cyan-400" disabled={busy} checked={enabled} onChange={(e) => onToggle(e.target.checked)} />
      </label>

      {!s ? <Skeleton className="h-24" /> : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {tile(t('queue.depth'), s.depth, s.depth > 0 ? 'text-amber-300' : 'text-white')}
            {tile(t('queue.inflight'), s.inflight)}
            {tile(t('queue.dead'), s.dead, s.dead > 0 ? 'text-rose-300' : 'text-white')}
            {tile(t('queue.processed'), s.processed, 'text-emerald-300')}
          </div>
          <p className="mt-3 text-xs text-slate-500">
            {t('queue.retried')}: {n(s.retried)} · {t('queue.rejected')}: {n(s.rejected)}
            {s.oldestAgeMs !== null && ` · ${t('queue.oldest')}: ${formatRelative(locale, -Math.round(s.oldestAgeMs / 1000))}`}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="primary" disabled={working} onClick={() => void act('drain')}>{t('queue.drain')}</Button>
            <Button disabled={working || s.dead === 0} onClick={() => void act('retry-dead')}>{t('queue.retryDead')}</Button>
            <Button variant="danger" disabled={working || s.dead === 0} onClick={() => void act('purge-dead')}>{t('queue.purgeDead')}</Button>
          </div>
        </>
      )}
      <Explainer className="mt-4" title={t('queue.help.title')} items={[t('queue.help.i1'), t('queue.help.i2'), t('queue.help.i3'), t('queue.help.i4'), t('queue.help.i5')]} />
    </section>
  );
}
