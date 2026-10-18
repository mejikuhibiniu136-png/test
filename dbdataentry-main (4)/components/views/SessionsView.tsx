'use client';
import { AnimatePresence } from 'motion/react';
import { Laptop, LogOut, Monitor, Smartphone, Tablet } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useI18n } from '@/components/i18n/I18nProvider';
import { AnimatedRow } from '@/components/motion/AnimatedRow';
import { StaggerItem } from '@/components/motion/Stagger';
import { Button } from '@/components/ui/Button';
import { Explainer } from '@/components/ui/Explainer';
import { ConfirmDialog, type ConfirmState } from '@/components/ui/Modal';
import { Pill } from '@/components/ui/Pill';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { apiJson } from '@/lib/client';
import { formatRelative } from '@/lib/i18n/format';
import { can } from '@/lib/rbac/permissions';
import type { SessionView } from '@/lib/sessions';
import type { Role } from '@/types';

type Notify = (m: string, t?: 'success' | 'error' | 'info') => void;
const ICON = { desktop: Laptop, mobile: Smartphone, tablet: Tablet } as const;

export function SessionsView({ role, toast }: { role: Role; toast: Notify }) {
  const { t, dt, locale } = useI18n();
  const canAll = can(role, 'sessions:read:all');
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [rows, setRows] = useState<SessionView[] | null>(null);
  const [filter, setFilter] = useState('ALL');
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const res = await apiJson<{ data: SessionView[] }>(`/api/sessions${scope === 'all' ? '?scope=all' : ''}`, 'GET');
      setRows(res.data); setNow(Date.now());
    } catch (e) { toast(e instanceof Error ? e.message : t('common.error'), 'error'); }
  }, [scope, toast, t]);

  useEffect(() => { setRows(null); setFilter('ALL'); void load(); }, [load]);
  useEffect(() => {
    const id = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 15_000);
    return () => clearInterval(id);
  }, [load]);

  const users = useMemo(() => [...new Set((rows ?? []).map((r) => r.username))].sort(), [rows]);
  const shown = useMemo(() => (rows ?? []).filter((r) => filter === 'ALL' || r.username === filter), [rows, filter]);
  const others = (rows ?? []).filter((r) => !r.current).length;

  const run = async (url: string) => {
    try {
      const res = await apiJson<{ revoked: number }>(url, 'DELETE');
      toast(res.revoked > 1 ? t('sessions.revokedMany', { count: res.revoked }) : t('sessions.revokedOne'), 'success');
      await load();
    } catch (e) { toast(e instanceof Error ? e.message : t('common.error'), 'error'); }
  };

  const revokeOne = (s: SessionView) => setConfirm({
    title: t('sessions.confirmTitle'), message: `${s.username} · ${s.browser} / ${s.os} · ${s.ip}. ${t('sessions.confirmBody')}`,
    confirmLabel: t('sessions.revoke'), danger: true, onConfirm: () => void run(`/api/sessions?sid=${encodeURIComponent(s.sid)}`),
  });
  const revokeOthers = () => setConfirm({ title: t('sessions.confirmOthersTitle'), message: t('sessions.confirmBody'), confirmLabel: t('sessions.revokeOthers'), danger: true, onConfirm: () => void run('/api/sessions?scope=others') });
  const revokeUser = (name: string) => setConfirm({ title: t('sessions.confirmAllTitle', { name }), message: t('sessions.confirmBody'), confirmLabel: t('sessions.revokeUser'), danger: true, onConfirm: () => void run(`/api/sessions?user=${encodeURIComponent(name)}&all=1`) });

  return (
    <div className="space-y-4">
      <StaggerItem className="flex flex-wrap items-end justify-between gap-3">
        <div><h2 className="text-lg font-semibold text-white">{t('sessions.title')}</h2><p className="text-sm text-slate-400">{t('sessions.subtitle')}</p></div>
        <div className="flex flex-wrap items-center gap-2">
          {canAll && (
            <div role="tablist" className="inline-flex rounded-xl border border-white/10 bg-black/20 p-1 text-xs">
              {(['mine', 'all'] as const).map((s) => <button key={s} role="tab" aria-selected={scope === s} onClick={() => setScope(s)} className={`min-h-8 cursor-pointer rounded-lg px-3 transition-colors ${scope === s ? 'bg-cyan-300/15 text-white' : 'text-slate-400 hover:text-slate-200'}`}>{t(s === 'mine' ? 'sessions.mine' : 'sessions.all')}</button>)}
            </div>
          )}
          {scope === 'all' && users.length > 1 && (
            <select className="field w-auto py-1.5 text-xs" aria-label={t('common.user')} value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="ALL">{t('sessions.all')}</option>{users.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          )}
          {scope === 'all' && filter !== 'ALL' && canAll && <Button size="sm" variant="danger" onClick={() => revokeUser(filter)}>{t('sessions.revokeUser')}</Button>}
          {scope === 'mine' && <Button size="sm" variant="danger" disabled={others === 0} onClick={revokeOthers}><LogOut className="size-3.5" aria-hidden />{t('sessions.revokeOthers')}</Button>}
        </div>
      </StaggerItem>

      <StaggerItem>
        {rows === null ? <SkeletonTable rows={4} cols={5} /> : shown.length === 0 ? (
          <div className="glass p-10 text-center text-sm text-slate-500">{t('sessions.empty')}</div>
        ) : (
          <div className="glass overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <thead className="text-xs text-slate-500"><tr className="border-b border-white/10">
                {scope === 'all' && <th className="px-4 py-3 font-medium">{t('common.user')}</th>}
                <th className="px-4 py-3 font-medium">{t('sessions.device')}</th><th className="px-4 py-3 font-medium">IP</th><th className="px-4 py-3 font-medium">{t('sessions.location')}</th>
                <th className="px-4 py-3 font-medium">{t('sessions.lastActive')}</th><th className="px-4 py-3 text-right font-medium">{t('common.actions')}</th>
              </tr></thead>
              <tbody>
                <AnimatePresence initial={false}>
                  {shown.map((s) => {
                    const Icon = ICON[s.deviceType as keyof typeof ICON] ?? Monitor;
                    const place = [s.city, s.country].filter(Boolean).join(', ') || '-';
                    return (
                      <AnimatedRow key={s.sid} className="border-b border-white/5 last:border-0">
                        {scope === 'all' && <td className="px-4 py-3 text-slate-200">{s.username}</td>}
                        <td className="px-4 py-3"><div className="flex items-center gap-2.5"><Icon className="size-4 flex-none text-slate-400" aria-hidden />
                          <div><div className="text-slate-100">{s.browser} · {s.os}</div><div className="text-[11px] text-slate-500" title={s.userAgent}>{t('sessions.created')}: {dt(s.createdAt, { dateStyle: 'short', timeStyle: 'short' })}</div></div>
                          {s.current && <Pill tone="ok">{t('sessions.current')}</Pill>}</div></td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-300">{s.ip}</td>
                        <td className="px-4 py-3 text-slate-300">{place}</td>
                        <td className="px-4 py-3 text-slate-400">{formatRelative(locale, Math.round((Date.parse(s.lastSeenAt) - now) / 1000))}</td>
                        <td className="px-4 py-3 text-right">{!s.current && <Button size="sm" variant="danger" onClick={() => revokeOne(s)}>{t('sessions.revoke')}</Button>}</td>
                      </AnimatedRow>
                    );
                  })}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
        )}
      </StaggerItem>
      <Explainer title={t('sessions.help.title')} items={[t('sessions.help.i1'), t('sessions.help.i2'), t('sessions.help.i3'), t('sessions.help.i4')]} />
      <ConfirmDialog dialog={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
