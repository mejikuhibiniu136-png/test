'use client';
import { Activity, Crosshair, Skull, Pause, Play, AlertTriangle, Heart, Backpack } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Explainer } from '@/components/ui/Explainer';
import { Pill } from '@/components/ui/Pill';
import { Skeleton } from '@/components/ui/Skeleton';
import { STATE_COLOR } from '@/components/ui/Pill';
import { apiJson } from '@/lib/client';
import { getAccountState } from '@/lib/accounts';
import type { ControlEntry, HwidLeak, LogEntry, TrackedAccount } from '@/types';

interface Props { loading: boolean; accounts: TrackedAccount[]; logs: LogEntry[]; now: number; isAdmin: boolean; toast: (m: string, t?: 'success' | 'error' | 'info') => void }

// Normalisasi koordinat dunia Roblox ke piksel kanvas. Skala adaptif berdasarkan rentang posisi
// yang ada; bila hanya satu titik, posisikan di tengah. Y dunia -> Y kanvas terbalik (atas = utara).
function project(value: number, min: number, max: number, span: number, pad: number): number {
  if (max - min < 1e-6) return span / 2;
  return pad + ((value - min) / (max - min)) * (span - pad * 2);
}

export function LiveCanvasView({ loading, accounts, logs, now, isAdmin, toast }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [controls, setControls] = useState<ControlEntry[]>([]);
  const [leaks, setLeaks] = useState<HwidLeak[]>([]);
  const [busy, setBusy] = useState(false);

  const positioned = useMemo(() => accounts.filter((a) => typeof a.positionX === 'number' && typeof a.positionY === 'number'), [accounts]);
  const bounds = useMemo(() => {
    if (positioned.length === 0) return null;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const a of positioned) {
      minX = Math.min(minX, a.positionX!); maxX = Math.max(maxX, a.positionX!);
      minY = Math.min(minY, a.positionY!); maxY = Math.max(maxY, a.positionY!);
    }
    return { minX, maxX, minY, maxY };
  }, [positioned]);

  const selectedAccount = useMemo(() => accounts.find((a) => a.username === selected) ?? null, [accounts, selected]);
  const recentLogs = useMemo(() => logs.slice(0, 12), [logs]);

  // Gambar ulang kanvas tiap data berubah. Hi-DPI: kalikan dimensi dengan devicePixelRatio.
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth, cssH = canvas.clientHeight;
    if (canvas.width !== cssW * dpr || canvas.height !== cssH * dpr) { canvas.width = cssW * dpr; canvas.height = cssH * dpr; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.fillStyle = '#0b1220'; ctx.fillRect(0, 0, cssW, cssH);
    ctx.strokeStyle = 'rgba(148,163,184,0.08)'; ctx.lineWidth = 1;
    const grid = 40;
    for (let x = 0; x <= cssW; x += grid) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, cssH); ctx.stroke(); }
    for (let y = 0; y <= cssH; y += grid) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(cssW, y); ctx.stroke(); }
    if (!bounds || positioned.length === 0) {
      ctx.fillStyle = 'rgba(148,163,184,0.5)'; ctx.font = '13px ui-sans-serif, system-ui';
      ctx.textAlign = 'center'; ctx.fillText('Menunggu telemetri posisi dari skrip…', cssW / 2, cssH / 2);
      return;
    }
    const pad = 28;
    for (const a of positioned) {
      const state = getAccountState(a, now);
      const px = project(a.positionX!, bounds.minX, bounds.maxX, cssW, pad);
      const py = project(a.positionY!, bounds.minY, bounds.maxY, cssH, pad);
      const color = STATE_COLOR[state];
      const isSel = a.username === selected;
      ctx.beginPath(); ctx.arc(px, py, isSel ? 9 : 6, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.globalAlpha = isSel ? 1 : 0.85; ctx.fill(); ctx.globalAlpha = 1;
      if (isSel) { ctx.beginPath(); ctx.arc(px, py, 14, 0, Math.PI * 2); ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke(); }
      ctx.fillStyle = isSel ? '#ffffff' : 'rgba(226,232,240,0.8)';
      ctx.font = `${isSel ? 'bold ' : ''}11px ui-sans-serif, system-ui`;
      ctx.textAlign = 'center'; ctx.fillText(a.username, px, py - 12);
    }
  }, [positioned, bounds, selected, now]);

  useEffect(() => { draw(); }, [draw]);
  useEffect(() => { const handler = () => draw(); window.addEventListener('resize', handler); return () => window.removeEventListener('resize', handler); }, [draw]);

  const onCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!bounds || positioned.length === 0) return;
    const canvas = canvasRef.current; if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
    const pad = 28; const cssW = canvas.clientWidth, cssH = canvas.clientHeight;
    let best: { name: string; d: number } | null = null;
    for (const a of positioned) {
      const px = project(a.positionX!, bounds.minX, bounds.maxX, cssW, pad);
      const py = project(a.positionY!, bounds.minY, bounds.maxY, cssH, pad);
      const d = Math.hypot(px - cx, py - cy);
      if (!best || d < best.d) best = { name: a.username, d };
    }
    if (best && best.d <= 24) setSelected(best.name);
  }, [positioned, bounds]);

  const loadControls = useCallback(async () => {
    try { const r = await apiJson<{ data: ControlEntry[] }>('/api/receiver/control', 'GET'); setControls(r.data ?? []); } catch { /* polling */ }
  }, []);
  const loadLeaks = useCallback(async () => {
    try { const r = await apiJson<{ data: HwidLeak[] }>('/api/hwid/leaks?limit=20', 'GET'); setLeaks(r.data ?? []); } catch { /* polling */ }
  }, []);
  useEffect(() => {
    if (!isAdmin) return;
    void loadControls(); void loadLeaks();
    const id = setInterval(() => { if (document.visibilityState === 'visible') { void loadControls(); void loadLeaks(); } }, 5000);
    return () => clearInterval(id);
  }, [isAdmin, loadControls, loadLeaks]);

  const sendCommand = useCallback(async (accountId: string, command: 'KILL' | 'PAUSE' | 'RESUME') => {
    setBusy(true);
    try { await apiJson('/api/receiver/control', 'POST', { accountId, command }); toast(`Perintah ${command} terkirim`, 'success'); void loadControls(); } catch (e) { toast(e instanceof Error ? e.message : 'Gagal mengirim perintah', 'error'); } finally { setBusy(false); }
  }, [toast, loadControls]);

  const activeCmd = (id: string) => controls.find((c) => c.accountId === id)?.command;
  const selState = selectedAccount ? getAccountState(selectedAccount, now) : null;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="glass p-3 lg:col-span-2">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-white"><Crosshair className="size-4" /> Peta Posisi Karakter</h3>
            <span className="text-xs text-slate-500">{positioned.length}/{accounts.length} akun melaporkan posisi</span>
          </div>
          {loading ? <Skeleton className="h-80" /> : (
            <canvas ref={canvasRef} onClick={onCanvasClick} className="h-80 w-full cursor-crosshair rounded-xl border border-white/10" aria-label="Kanvas posisi karakter real-time" />
          )}
          <p className="mt-2 text-xs text-slate-500">Klik titik untuk memilih akun. Warna: <span className="text-emerald-300">Online</span> · <span className="text-amber-300">Stalled</span> · <span className="text-rose-300">Offline</span>.</p>
        </section>

        <section className="glass p-4">
          <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-white"><Activity className="size-4" /> Detail & Kontrol</h3>
          {!selectedAccount ? (
            <p className="text-sm text-slate-500">Pilih akun di peta untuk melihat health/inventaris dan mengirim perintah.</p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="truncate font-medium text-white">{selectedAccount.displayName || selectedAccount.username}</span>
                {selState && <Pill tone={selState === 'ONLINE' ? 'ok' : selState === 'STALLED' ? 'warn' : 'bad'} dot={selState === 'ONLINE' ? 'live' : 'static'}>{selState}</Pill>}
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                  <span className="flex items-center gap-1 text-slate-400"><Heart className="size-3" /> Health</span>
                  <span className="text-base font-semibold text-white">{selectedAccount.health ?? '—'}</span>
                </div>
                <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                  <span className="text-slate-400">Posisi (X,Z)</span>
                  <span className="text-base font-semibold text-white">{selectedAccount.positionX ?? '—'}, {selectedAccount.positionY ?? '—'}</span>
                </div>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                <span className="flex items-center gap-1 text-xs text-slate-400"><Backpack className="size-3" /> Inventaris</span>
                <p className="mt-0.5 text-xs text-slate-200">{selectedAccount.inventory || 'Kosong'}</p>
              </div>
              {activeCmd(selectedAccount.username) && <Pill tone="warn" dot="live">Perintah aktif: {activeCmd(selectedAccount.username)}</Pill>}
              {isAdmin && (
                <div className="grid grid-cols-3 gap-2 pt-1">
                  <Button size="sm" variant="danger" disabled={busy} onClick={() => sendCommand(selectedAccount.username, 'KILL')}><Skull className="size-3.5" />KILL</Button>
                  <Button size="sm" disabled={busy} onClick={() => sendCommand(selectedAccount.username, 'PAUSE')}><Pause className="size-3.5" />PAUSE</Button>
                  <Button size="sm" variant="primary" disabled={busy} onClick={() => sendCommand(selectedAccount.username, 'RESUME')}><Play className="size-3.5" />RESUME</Button>
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="glass p-4">
          <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-white"><Activity className="size-4" /> Log Aktivitas</h3>
          {recentLogs.length === 0 ? (
            <p className="text-sm text-slate-500">Belum ada aktivitas. Stream SSE memperbarui daftar ini otomatis.</p>
          ) : (
            <ul className="space-y-1.5 text-xs">
              {recentLogs.map((l) => (
                <li key={l.id} className="flex items-start gap-2 rounded-lg border border-white/5 bg-black/20 px-2.5 py-1.5">
                  <span className="mt-0.5 size-1.5 flex-none rounded-full bg-cyan-400" />
                  <span className="flex-1 text-slate-300"><span className="font-medium text-slate-100">{l.eventType}</span> · {l.gameName}</span>
                  <span className="flex-none text-slate-500">{new Date(l.receivedAt).toLocaleTimeString()}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="glass p-4">
          <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-white"><AlertTriangle className="size-4" /> Peringatan Kebocoran HWID</h3>
          {!isAdmin ? (
            <p className="text-sm text-slate-500">Panel ini untuk staf (admin/superadmin).</p>
          ) : leaks.length === 0 ? (
            <p className="text-sm text-slate-500">Tidak ada kebocoran terdeteksi. Skrip ber-watermark melaporkan otomatis saat HWID tidak cocok.</p>
          ) : (
            <ul className="space-y-1.5 text-xs">
              {leaks.map((lk) => (
                <li key={lk.id} className="rounded-lg border border-rose-400/20 bg-rose-500/5 px-2.5 py-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-rose-200">{lk.accountId}</span>
                    <span className="text-slate-500">{new Date(lk.at).toLocaleTimeString()}</span>
                  </div>
                  <p className="mt-0.5 text-slate-400">Diharapkan <code className="text-slate-300">{lk.expectedHwid}</code> · Terdeteksi <code className="text-rose-300">{lk.detectedHwid}</code> · {lk.reason}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <Explainer title="Cara kerja Live Canvas & Kill-Switch" items={[
        'Peta menampilkan posisi karakter (X, Z) yang dikirim skrip ber-watermark via webhook universal. Skala menyesuaikan rentang posisi yang ada; klik titik untuk memilih akun.',
        'Kill-switch: tombol KILL/PAUSE/RESUME mengirim perintah ke Redis dengan TTL 60 detik. Skrip polling tiap 5 detik; KILL menghentikan skrip dan membersihkan memorinya.',
        'HWID watermark: setiap unduhan skrip menyisipkan payload terenkripsi (accountId, userId, hwidHash, timestamp). Skrip memverifikasi HWID lokal sebelum berjalan; ketidakcocokan dilaporkan ke panel ini.',
      ]} />
    </div>
  );
}


