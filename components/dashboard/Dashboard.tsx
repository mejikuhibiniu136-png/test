'use client';
import { AnimatePresence, motion } from 'motion/react';
import { CircleHelp, Pause, Play } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '@/components/i18n/I18nProvider';
import { LanguageSwitcher } from '@/components/i18n/LanguageSwitcher';
import { TOUR_EVENT, WELCOME_COOKIE } from '@/components/onboarding/constants';
import { getCopy } from '@/components/onboarding/copy';
import { Sidebar, VIEWS, type ViewId } from '@/components/dashboard/Sidebar';
import { PageTransition } from '@/components/motion/Stagger';
import { LogDrawer } from '@/components/tables/LogList';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog, NameDialog, type ConfirmState } from '@/components/ui/Modal';
import { Pill } from '@/components/ui/Pill';
import { Toasts } from '@/components/ui/Toasts';
import { AccountsView } from '@/components/views/AccountsView';
import { AnalyticsView } from '@/components/views/AnalyticsView';
import { GamesView } from '@/components/views/GamesView';
import { LogsView } from '@/components/views/LogsView';
import { LiveCanvasView } from '@/components/views/LiveCanvasView';
import { OverviewView } from '@/components/views/OverviewView';
import { SessionsView } from '@/components/views/SessionsView';
import { SystemView } from '@/components/views/SystemView';
import { UsersView } from '@/components/views/UsersView';
import { apiJson, copyText, downloadText, useLiveStream, useToasts, type Connection } from '@/lib/client';
import type { MessageKey } from '@/lib/i18n/dictionaries/en';
import type { GameTable, LogEntry, Role, StreamPayload, TrackedAccount } from '@/types';

const LIMITS = [50, 100, 200, 500];
const CONNECTION: Record<Connection, { tone: 'ok' | 'neutral' | 'warn'; key: MessageKey }> = {
  live: { tone: 'ok', key: 'header.live' }, connecting: { tone: 'neutral', key: 'header.connecting' },
  reconnecting: { tone: 'warn', key: 'header.reconnecting' }, paused: { tone: 'warn', key: 'header.paused' },
};

export function Dashboard({ username, role }: { username: string; role: Role }) {
  const { t, locale } = useI18n();
  // RBAC berjenjang: Superadmin (mutlak) > Admin (CRUD akun/game, baca pengguna/log) > Viewer (baca saja).
  const isStaff = role === 'admin' || role === 'superadmin';
  const isSuperadmin = role === 'superadmin';
  const [view, setView] = useState<ViewId>('overview');
  const [pendingCount, setPendingCount] = useState(0);
  const [game, setGame] = useState<string>('all');
  const [games, setGames] = useState<GameTable[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [accounts, setAccounts] = useState<TrackedAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [paused, setPaused] = useState(false);
  const [limit, setLimit] = useState(100);
  const [now, setNow] = useState(() => Date.now());
  const [selected, setSelected] = useState<LogEntry | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [nameDialog, setNameDialog] = useState<{ mode: 'create' | 'rename'; game?: GameTable } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [newIds, setNewIds] = useState<Set<string>>(() => new Set());
  const { toasts, push: toast } = useToasts();

  const seen = useRef<Set<string> | null>(null);
  const seenGame = useRef(game);
  const clockOffset = useRef(0);
  const prevStates = useRef<Map<string, string> | null>(null);
  const newTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Jam detik untuk uptime dan status. Dikoreksi dengan selisih jam server agar jam perangkat yang meleset tidak menyesatkan.
  useEffect(() => { const t = setInterval(() => setNow(Date.now() + clockOffset.current), 1000); return () => clearInterval(t); }, []);

  // Badge "menunggu persetujuan" di Sidebar harus terlihat walau belum membuka menu Pengguna.
  useEffect(() => {
    if (!isSuperadmin) return;
    apiJson<{ data: { status: string }[] }>('/api/admin/users', 'GET')
      .then((res) => setPendingCount(res.data.filter((u) => u.status === 'pending').length))
      .catch(() => undefined);
  }, [isSuperadmin]);

  const onStream = useCallback((d: StreamPayload) => {
    clockOffset.current = d.timestamp - Date.now();
    setGames(d.games);
    setAccounts(d.accounts);

    // Tandai log baru (kecuali muatan pertama atau setelah pindah tabel).
    if (seen.current === null || seenGame.current !== d.game) {
      seen.current = new Set(d.logs.map((l) => l.id));
      seenGame.current = d.game;
    } else {
      const fresh = d.logs.filter((l) => !seen.current!.has(l.id)).map((l) => l.id);
      seen.current = new Set(d.logs.map((l) => l.id));
      if (fresh.length) {
        setNewIds(new Set(fresh));
        clearTimeout(newTimer.current);
        newTimer.current = setTimeout(() => setNewIds(new Set()), 2000);
      }
    }
    setLogs(d.logs);

    // Notifikasi saat akun berpindah antara online dan offline.
    const next = new Map(d.accounts.map((a) => [a.username, a.state]));
    if (prevStates.current) {
      for (const a of d.accounts) {
        const before = prevStates.current.get(a.username);
        if (before === 'ONLINE' && a.state === 'OFFLINE') toast(`${a.displayName || a.username} offline`, 'error');
        else if (before === 'OFFLINE' && a.state === 'ONLINE') toast(`${a.displayName || a.username} kembali online`, 'success');
      }
    }
    prevStates.current = next;
    setLoading(false);
  }, [toast]);

  const connection = useLiveStream({ paused, game, limit, onData: onStream });

  // Pindah tabel: kosongkan daftar agar skeleton tampil sampai data tabel baru tiba.
  const switchGame = useCallback((slug: string) => { if (slug !== game) { setGame(slug); setLogs([]); setLoading(true); } }, [game]);
  useEffect(() => { if (game !== 'all' && games.length && !games.some((g) => g.slug === game)) switchGame('all'); }, [games, game, switchGame]);

  const gameLabel = game === 'all' ? 'Semua tabel' : games.find((g) => g.slug === game)?.name ?? game;

  const run = useCallback(async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); toast(ok, 'success'); } catch (e) { toast(e instanceof Error ? e.message : 'Aksi gagal', 'error'); }
  }, [toast]);

  const copyResult = useCallback((ok: boolean, label: string) => toast(ok ? `${label} disalin` : 'Gagal menyalin; salin manual dari kotak', ok ? 'success' : 'error'), [toast]);
  const copyLog = useCallback(async (l: LogEntry) => {
    if (await copyText(JSON.stringify(l.payload, null, 2))) { setCopiedId(l.id); setTimeout(() => setCopiedId((c) => (c === l.id ? null : c)), 1500); } else toast('Gagal menyalin', 'error');
  }, [toast]);
  const copyJob = useCallback(async (a: TrackedAccount) => copyResult(await copyText(a.jobId), 'Job ID'), [copyResult]);

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    document.cookie = `${WELCOME_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`; // pengguna berikutnya melihat Welcome lagi
    window.location.href = '/login'; };

  const clearLogs = () => setConfirm({
    title: 'Hapus log?', danger: true, confirmLabel: 'Hapus log',
    message: game === 'all'
      ? 'Semua log (stream gabungan dan seluruh tabel game) akan dihapus. Akun terdaftar, riwayat perangkat, dan daftar akun tidak terpengaruh.'
      : `Log pada tabel "${gameLabel}" akan dihapus. Akun terdaftar, riwayat perangkat, dan daftar akun tidak terpengaruh.`,
    onConfirm: () => run(() => apiJson(`/api/logs?game=${encodeURIComponent(game)}`, 'DELETE'), 'Log dibersihkan'),
  });

  const submitName = async (name: string) => {
    if (nameDialog?.mode === 'create') { await apiJson('/api/games', 'POST', { name }); toast(`Tabel "${name}" dibuat`, 'success'); } else if (nameDialog?.game) {
      const res = await apiJson<{ data: GameTable }>(`/api/games/${nameDialog.game.slug}`, 'PATCH', { name });
      if (game === nameDialog.game.slug) switchGame(res.data.slug);
      toast('Nama tabel diubah', 'success');
    }
  };

  const content = useMemo(() => {
    switch (view) {
      case 'overview': return <OverviewView loading={loading} logs={logs} games={games} accounts={accounts} now={now} gameLabel={gameLabel} onCopyResult={copyResult} />;
      case 'logs': return <LogsView loading={loading} logs={logs} newIds={newIds} copiedId={copiedId} showGame={game === 'all'} gameLabel={gameLabel} gameSlug={game} isAdmin={isStaff} onOpen={setSelected} onCopy={copyLog} onClear={clearLogs} toast={toast} />;
      case 'games': return <GamesView loading={loading && games.length === 0} games={games} isAdmin={isStaff} onCreate={() => setNameDialog({ mode: 'create' })}
        onOpen={(g) => { switchGame(g.slug); setView('logs'); }} onRename={(g) => setNameDialog({ mode: 'rename', game: g })}
        onDelete={(g) => setConfirm({ title: `Hapus tabel "${g.name}"?`, danger: true, confirmLabel: 'Hapus tabel', message: 'Tabel beserta seluruh lognya dihapus permanen. Jika sumbernya masih mengirim data, tabel akan dibuat ulang otomatis dari nol.', onConfirm: () => run(() => apiJson(`/api/games/${g.slug}`, 'DELETE'), 'Tabel dihapus') })} />;
      case 'accounts': return <AccountsView loading={loading} accounts={accounts} logs={logs} now={now} isAdmin={isStaff} onCopyJob={copyJob}
        onDelete={(a) => setConfirm({ title: `Hapus akun ${a.username}?`, danger: true, confirmLabel: 'Hapus akun', message: 'Akun dihapus dari daftar tracker. Akan muncul lagi jika script masih mengirim heartbeat.', onConfirm: () => run(() => apiJson(`/api/accounts?username=${encodeURIComponent(a.username)}`, 'DELETE'), 'Akun dihapus') })} />;
      case 'analytics': return <AnalyticsView loading={loading} logs={logs} gameLabel={gameLabel} />;
      case 'live': return <LiveCanvasView loading={loading} accounts={accounts} logs={logs} now={now} isAdmin={isStaff} toast={toast} />;
      case 'sessions': return <SessionsView role={role} toast={toast} />;
      case 'users': return isStaff ? <UsersView role={role} toast={toast} onPendingCount={setPendingCount} /> : null;
      case 'system': return isSuperadmin ? <SystemView toast={toast} /> : null;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, loading, logs, games, accounts, now, gameLabel, newIds, copiedId, game, isStaff, isSuperadmin, role, copyResult, copyLog, copyJob, toast]);

  const showSwitcher = view === 'overview' || view === 'logs' || view === 'analytics';
  const current = VIEWS.find((v) => v.id === view);
  const conn = CONNECTION[connection];

  return (
    <div className="mx-auto flex max-w-[96rem] gap-5 p-3 pb-24 sm:p-4 lg:pb-4">
      <Sidebar view={view} onView={setView} role={role} username={username} onLogout={logout} pendingCount={pendingCount} />

      <main data-tour="content" className="min-w-0 flex-1 space-y-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-white">{current ? t(current.labelKey) : ''}</h1>
            <p className="text-sm text-slate-400">{t('header.greeting', { name: username })}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span data-tour="status"><Pill tone={conn.tone} dot={connection === 'live' ? 'live' : 'static'}>{t(conn.key)}</Pill></span>
            <LanguageSwitcher compact align="right" />
            <span data-tour="controls" className="flex items-center gap-2">
            <select className="field w-auto py-1.5 text-xs" aria-label={t('header.logsLoaded')} value={limit} onChange={(e) => setLimit(Number(e.target.value))}>{LIMITS.map((l) => <option key={l} value={l}>{t('header.logCount', { count: l })}</option>)}</select>
            <Button size="sm" onClick={() => setPaused((p) => !p)}>{paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}{paused ? t('header.resume') : t('header.pause')}</Button>
            </span>
            <Button size="sm" variant="subtle" onClick={() => window.dispatchEvent(new Event(TOUR_EVENT))}><CircleHelp className="size-3.5" aria-hidden />{getCopy(locale).replay}</Button>
          </div>
        </header>

        {showSwitcher && (
          <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Pilih tabel game">
            {[{ slug: 'all', name: 'Semua' }, ...games].map((g) => {
              const active = g.slug === game;
              return (
                <button key={g.slug} role="tab" aria-selected={active} onClick={() => switchGame(g.slug)} className={`relative flex-none cursor-pointer rounded-full border px-3.5 py-1.5 text-sm transition-colors ${active ? 'border-cyan-300/40 text-white' : 'border-white/10 text-slate-400 hover:text-slate-100'}`}>
                  {active && <motion.span layoutId="game-chip" className="absolute inset-0 rounded-full bg-cyan-300/15" transition={{ type: 'spring', stiffness: 400, damping: 32 }} />}
                  <span className="relative">{g.name}</span>
                </button>
              );
            })}
          </div>
        )}

        <AnimatePresence mode="wait" initial={false}>
          <PageTransition key={view}>{content}</PageTransition>
        </AnimatePresence>
      </main>

      <LogDrawer log={selected} onClose={() => setSelected(null)} onCopy={copyLog} onDownload={(l) => downloadText(`log-${l.id}.json`, JSON.stringify(l, null, 2))} />
      <ConfirmDialog dialog={confirm} onClose={() => setConfirm(null)} />
      <NameDialog open={Boolean(nameDialog)} onClose={() => setNameDialog(null)}
        title={nameDialog?.mode === 'create' ? 'Buat tabel game' : 'Ganti nama tabel'} label="Nama game / sumber" initial={nameDialog?.game?.name ?? ''}
        submitLabel={nameDialog?.mode === 'create' ? 'Buat' : 'Simpan'} onSubmit={submitName} />
      <Toasts toasts={toasts} />
    </div>
  );
}
