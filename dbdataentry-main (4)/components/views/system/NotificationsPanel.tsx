'use client';
import { AnimatePresence, motion } from 'motion/react';
import { BellRing, Send, ShieldCheck, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '@/components/i18n/I18nProvider';
import { SPRING_SNAPPY } from '@/components/motion/variants';
import { Button } from '@/components/ui/Button';
import { Explainer } from '@/components/ui/Explainer';
import { Pill } from '@/components/ui/Pill';
import { Skeleton } from '@/components/ui/Skeleton';
import { apiJson } from '@/lib/client';
import type { MessageKey } from '@/lib/i18n/dictionaries/en';
import { ALERT_KINDS, SEVERITIES, type AlertKind, type ChannelView, type DeliveryRecord, type Platform, type Severity } from '@/lib/notify/types';

interface Payload { channel: ChannelView; deliveries: DeliveryRecord[]; encryptionReady: boolean }
type Notify = (m: string, t?: 'success' | 'error' | 'info') => void;

const PLATFORMS: Platform[] = ['discord', 'telegram'];
const SELECTABLE = ALERT_KINDS.filter((k) => k !== 'system.test');
const SEV_TONE = { info: 'accent', warning: 'warn', critical: 'bad' } as const;

// Superadmin: SATU formulir dinamis. Pilihan platform mengubah kolom yang tampil (Discord: satu URL;
// Telegram: token + chat ID). Rahasia tidak pernah dikembalikan server; kolom kosong = pertahankan nilai tersimpan.
export function NotificationsPanel({ toast }: { toast: Notify }) {
  const { t, dt } = useI18n();
  const [data, setData] = useState<Payload | null>(null);
  const [platform, setPlatform] = useState<Platform>('discord');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [botToken, setBotToken] = useState('');
  const [chatId, setChatId] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [minSeverity, setMinSeverity] = useState<Severity>('info');
  const [kinds, setKinds] = useState<'all' | AlertKind[]>('all');
  const [busy, setBusy] = useState<'save' | 'test' | 'remove' | null>(null);
  const [armed, setArmed] = useState(false);
  const armTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const apply = useCallback((p: Payload, resetSecrets = true) => {
    setData(p);
    if (p.channel.platform) setPlatform(p.channel.platform);
    setEnabled(p.channel.configured ? p.channel.enabled : true);
    setMinSeverity(p.channel.minSeverity);
    setKinds(p.channel.kinds);
    if (resetSecrets) { setWebhookUrl(''); setBotToken(''); setChatId(''); }
  }, []);

  const load = useCallback(async () => {
    try { apply(await apiJson<Payload>('/api/admin/notifications', 'GET')); } catch (e) { toast(e instanceof Error ? e.message : t('common.error'), 'error'); }
  }, [apply, toast, t]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => () => clearTimeout(armTimer.current), []);

  const savedPlatform = data?.channel.platform;
  const keepSaved = data?.channel.configured && savedPlatform === platform;
  const canSave = Boolean(data?.encryptionReady) && busy === null && (keepSaved || (platform === 'discord' ? webhookUrl.trim() : botToken.trim() && chatId.trim()));

  const save = async () => {
    setBusy('save');
    try {
      // Hanya kolom rahasia yang diisi yang dikirim: server mempertahankan nilai tersimpan untuk sisanya.
      const secrets: Record<string, string> = platform === 'discord' ? { webhookUrl: webhookUrl.trim() } : { botToken: botToken.trim(), chatId: chatId.trim() };
      for (const k of Object.keys(secrets)) if (!secrets[k]) delete secrets[k];
      const body = { platform, enabled, minSeverity, kinds, ...secrets };
      apply(await apiJson<Payload>('/api/admin/notifications', 'PUT', body));
      toast(t('notify.saved'), 'success');
    } catch (e) { toast(e instanceof Error ? e.message : t('common.error'), 'error'); } finally { setBusy(null); }
  };

  const test = async () => {
    setBusy('test');
    try { await apiJson('/api/admin/notifications/test', 'POST'); toast(t('notify.testSent'), 'success'); } catch (e) { toast(e instanceof Error ? e.message : t('notify.testFailed'), 'error'); } finally { setBusy(null); void load(); }
  };

  const remove = async () => {
    if (!armed) { setArmed(true); armTimer.current = setTimeout(() => setArmed(false), 4000); return; }
    setArmed(false); setBusy('remove');
    try { apply(await apiJson<Payload>('/api/admin/notifications', 'DELETE')); } catch (e) { toast(e instanceof Error ? e.message : t('common.error'), 'error'); } finally { setBusy(null); }
  };

  const toggleKind = (k: AlertKind) => setKinds((cur) => {
    const base = cur === 'all' ? [...SELECTABLE] : cur;
    const next = base.includes(k) ? base.filter((x) => x !== k) : [...base, k];
    return next.length === 0 ? base : next; // minimal satu jenis
  });

  return (
    <section className="glass p-5" aria-labelledby="notify-title">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="notify-title" className="flex items-center gap-2 text-sm font-semibold text-white"><BellRing className="size-4 text-cyan-300" aria-hidden />{t('notify.title')}</h3>
          <p className="mt-1 text-xs text-slate-500">{t('notify.subtitle')}</p>
        </div>
        {data && <Pill tone={data.channel.configured ? 'ok' : 'neutral'}>{data.channel.configured ? t('notify.configured') : t('notify.notConfigured')}</Pill>}
      </div>

      {!data ? <Skeleton className="h-48" /> : (
        <div className="space-y-5">
          {!data.encryptionReady && <p className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{t('notify.encryptionMissing')}</p>}

          <fieldset>
            <legend className="mb-2 text-xs font-medium text-slate-400">{t('notify.platform')}</legend>
            <div role="radiogroup" className="relative inline-flex rounded-xl border border-white/10 bg-black/20 p-1">
              {PLATFORMS.map((p) => (
                <button key={p} type="button" role="radio" aria-checked={platform === p} onClick={() => setPlatform(p)}
                  className={`relative min-h-9 cursor-pointer rounded-lg px-4 text-sm transition-colors ${platform === p ? 'text-white' : 'text-slate-400 hover:text-slate-200'}`}>
                  {platform === p && <motion.span layoutId="notify-platform" transition={SPRING_SNAPPY} className="absolute inset-0 rounded-lg border border-cyan-300/30 bg-gradient-to-r from-cyan-300/15 to-violet-400/10" />}
                  <span className="relative">{t(`notify.${p}` as MessageKey)}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={platform} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }} className="grid gap-3 sm:grid-cols-2">
              {platform === 'discord' ? (
                <label className="sm:col-span-2">
                  <span className="mb-1 block text-xs text-slate-400">{t('notify.webhookUrl')}</span>
                  <input type="password" autoComplete="off" spellCheck={false} className="field font-mono text-xs" value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)}
                    placeholder={keepSaved ? `${data.channel.hint ?? ''} · ${t('notify.keepHint')}` : 'https://discord.com/api/webhooks/…'} />
                </label>
              ) : (
                <>
                  <label>
                    <span className="mb-1 block text-xs text-slate-400">{t('notify.botToken')}</span>
                    <input type="password" autoComplete="off" spellCheck={false} className="field font-mono text-xs" value={botToken} onChange={(e) => setBotToken(e.target.value)} placeholder={keepSaved ? t('notify.keepHint') : '123456789:AA…'} />
                  </label>
                  <label>
                    <span className="mb-1 block text-xs text-slate-400">{t('notify.chatId')}</span>
                    <input autoComplete="off" spellCheck={false} className="field font-mono text-xs" value={chatId} onChange={(e) => setChatId(e.target.value)} placeholder={keepSaved ? t('notify.keepHint') : '-1001234567890'} />
                  </label>
                </>
              )}
            </motion.div>
          </AnimatePresence>
          {keepSaved && data.channel.hint && <p className="font-mono text-[11px] text-slate-500">{data.channel.hint}</p>}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/20 px-4 py-3">
              <span className="text-sm text-slate-200">{t('notify.enabled')}</span>
              <input type="checkbox" className="size-4 accent-cyan-400" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            </label>
            <label className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/20 px-4 py-3">
              <span className="text-sm text-slate-200">{t('notify.minSeverity')}</span>
              <select className="field w-auto py-1.5 text-xs" value={minSeverity} onChange={(e) => setMinSeverity(e.target.value as Severity)}>
                {SEVERITIES.map((s) => <option key={s} value={s}>{t(`notify.severity.${s}` as MessageKey)}</option>)}
              </select>
            </label>
          </div>

          <fieldset>
            <legend className="mb-2 flex items-center gap-3 text-xs font-medium text-slate-400">
              {t('notify.kinds')}
              <label className="flex cursor-pointer items-center gap-1.5 font-normal text-slate-300"><input type="checkbox" className="size-3.5 accent-cyan-400" checked={kinds === 'all'} onChange={(e) => setKinds(e.target.checked ? 'all' : [...SELECTABLE])} />{t('notify.allKinds')}</label>
            </legend>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {SELECTABLE.map((k) => (
                <label key={k} className={`flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition-colors ${kinds === 'all' ? 'text-slate-500' : 'text-slate-200 hover:bg-white/[0.04]'}`}>
                  <input type="checkbox" className="size-3.5 accent-cyan-400" disabled={kinds === 'all'} checked={kinds === 'all' || kinds.includes(k)} onChange={() => toggleKind(k)} />{t(`notify.kind.${k}` as MessageKey)}
                </label>
              ))}
            </div>
          </fieldset>

          <p className="flex items-center gap-1.5 text-[11px] text-slate-500"><ShieldCheck className="size-3.5 text-emerald-400" aria-hidden />{t('notify.sealedNote')}</p>

          <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={!canSave} onClick={() => void save()}>{t('notify.save')}</Button>
            <Button disabled={!data.channel.configured || busy !== null} onClick={() => void test()}><Send className="size-3.5" aria-hidden />{t('common.test')}</Button>
            {data.channel.configured && <Button variant="danger" disabled={busy !== null} onClick={() => void remove()}><Trash2 className="size-3.5" aria-hidden />{armed ? t('common.confirm') : t('notify.remove')}</Button>}
          </div>

          <div>
            <h4 className="mb-2 text-xs font-medium text-slate-400">{t('notify.history')}</h4>
            {data.deliveries.length === 0 ? <p className="text-xs text-slate-500">{t('notify.noHistory')}</p> : (
              <ul className="space-y-1.5">
                <AnimatePresence initial={false}>
                  {data.deliveries.slice(0, 8).map((d) => (
                    <motion.li key={d.id} layout="position" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} className="flex flex-wrap items-center gap-2 rounded-lg bg-black/20 px-3 py-1.5 text-xs">
                      <Pill tone={d.ok ? 'ok' : 'bad'}>{d.ok ? 'OK' : d.status ?? 'ERR'}</Pill>
                      <Pill tone={SEV_TONE[d.severity]}>{t(`notify.severity.${d.severity}` as MessageKey)}</Pill>
                      <span className="min-w-0 flex-1 truncate text-slate-300">{d.title}</span>
                      <span className="text-slate-500">{dt(d.at, { timeStyle: 'short', dateStyle: 'short' })}</span>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            )}
          </div>
        </div>
      )}
      <Explainer className="mt-4" title={t('notify.help.title')} items={[t('notify.help.i1'), t('notify.help.i2'), t('notify.help.i3'), t('notify.help.i4')]} />
    </section>
  );
}
