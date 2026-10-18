'use client';
import { Bot, Check, Monitor, Pause, Play, Smartphone, Tablet, HelpCircle, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Pill, type Tone } from '@/components/ui/Pill';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { apiJson } from '@/lib/client';
import type { DeviceEntry, StorableRole, UserStatus, UserSummary } from '@/types';

const DEVICE_ICON = { desktop: Monitor, mobile: Smartphone, tablet: Tablet, bot: Bot, unknown: HelpCircle } as const;
const place = (d: DeviceEntry) => [d.city, d.region, d.country].filter(Boolean).join(', ') || 'Lokasi tidak tersedia';

// Pill modern: kuning/oranye untuk Pending, hijau emerald untuk Active, merah/muted untuk Rejected/Suspended.
const STATUS_TONE: Record<UserStatus, Tone> = { pending: 'warn', active: 'ok', suspended: 'bad', rejected: 'neutral' };
const STATUS_LABEL: Record<UserStatus, string> = { pending: 'Menunggu', active: 'Aktif', suspended: 'Ditangguhkan', rejected: 'Ditolak' };
const ROLE_TONE: Record<string, Tone> = { superadmin: 'violet', admin: 'accent', viewer: 'neutral' };

export function UsersTable({
  users, canManage, onChanged,
}: { users: UserSummary[] | null; canManage: boolean; onChanged: () => void }) {
  const [selected, setSelected] = useState<UserSummary | null>(null);
  const [devices, setDevices] = useState<DeviceEntry[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const open = async (u: UserSummary) => {
    setSelected(u); setDevices(null);
    try { setDevices((await apiJson<{ data: DeviceEntry[] }>(`/api/admin/users/${encodeURIComponent(u.username)}/devices`, 'GET')).data); } catch { setDevices([]); }
  };

  const update = async (u: UserSummary, patch: { status?: UserStatus; role?: StorableRole }) => {
    setBusy(u.username);
    try { await apiJson(`/api/admin/users/${encodeURIComponent(u.username)}`, 'PATCH', patch); onChanged(); } finally { setBusy(null); }
  };

  if (!users) return <SkeletonRows count={3} />;
  if (users.length === 0) return <div className="glass p-6 text-center text-sm text-slate-400">Tidak ada pengguna pada filter ini.</div>;

  return (
    <>
      <div className="glass overflow-x-auto">
        <table className="w-full min-w-[46rem] text-left text-sm">
          <caption className="sr-only">Daftar pengguna</caption>
          <thead className="border-b border-white/10 text-xs text-slate-400">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">Pengguna</th>
              <th scope="col" className="px-4 py-3 font-medium">Role</th>
              <th scope="col" className="px-4 py-3 font-medium">Status</th>
              <th scope="col" className="px-4 py-3 font-medium">Login terakhir</th>
              <th scope="col" className="px-4 py-3"><span className="sr-only">Aksi</span></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const isBusy = busy === u.username;
              return (
                <tr key={u.username} className="border-b border-white/5 last:border-0 hover:bg-white/[0.03]">
                  <td className="px-4 py-3 font-medium text-white">{u.username}{u.immutable && <span className="ml-1.5 text-xs text-slate-500">(env)</span>}</td>
                  <td className="px-4 py-3">
                    {canManage && !u.immutable ? (
                      <select className="field w-auto py-1 text-xs" value={u.role} disabled={isBusy}
                        onChange={(e) => void update(u, { role: e.target.value as StorableRole })}>
                        <option value="viewer">viewer</option>
                        <option value="admin">admin</option>
                      </select>
                    ) : <Pill tone={ROLE_TONE[u.role] ?? 'neutral'}>{u.role}</Pill>}
                  </td>
                  <td className="px-4 py-3"><Pill tone={STATUS_TONE[u.status]}>{STATUS_LABEL[u.status]}</Pill></td>
                  <td className="px-4 py-3 text-xs text-slate-400">{u.lastLogin ? `${u.lastLogin.browser} · ${u.lastLogin.device} · ${u.lastLogin.ip} · ${new Date(u.lastLogin.at).toLocaleString('id-ID')}` : 'Belum pernah'}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      {canManage && !u.immutable && u.status === 'pending' && (
                        <>
                          <Button size="sm" variant="ghost" disabled={isBusy} onClick={() => void update(u, { status: 'active' })} className="border-emerald-400/30 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20"><Check className="size-3.5" />Setujui</Button>
                          <Button size="sm" variant="danger" disabled={isBusy} onClick={() => void update(u, { status: 'rejected' })}><X className="size-3.5" />Tolak</Button>
                        </>
                      )}
                      {canManage && !u.immutable && u.status === 'active' && (
                        <Button size="sm" variant="danger" disabled={isBusy} onClick={() => void update(u, { status: 'suspended' })}><Pause className="size-3.5" />Tangguhkan</Button>
                      )}
                      {canManage && !u.immutable && (u.status === 'suspended' || u.status === 'rejected') && (
                        <Button size="sm" disabled={isBusy} onClick={() => void update(u, { status: 'active' })}><Play className="size-3.5" />Aktifkan</Button>
                      )}
                      <Button size="sm" onClick={() => open(u)}>Perangkat</Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Modal open={Boolean(selected)} onClose={() => setSelected(null)} title={`Riwayat login · ${selected?.username ?? ''}`} wide>
        {!devices ? <SkeletonRows count={3} /> : devices.length === 0 ? <p className="text-sm text-slate-400">Belum ada riwayat login.</p> : (
          <ul className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
            {devices.map((d) => {
              const Icon = DEVICE_ICON[d.deviceType] ?? HelpCircle;
              return (
                <li key={d.sid || d.at} className="flex gap-3 rounded-xl border border-white/10 bg-black/25 p-3">
                  <Icon className="mt-0.5 size-5 flex-none text-cyan-300" aria-hidden />
                  <div className="min-w-0 text-sm">
                    <div className="font-medium text-white">{d.device} · {d.browser}</div>
                    <div className="text-xs text-slate-400">{d.ip} · {place(d)}{d.isp ? ` · ${d.isp}` : ''}</div>
                    <div className="text-xs text-slate-500">{new Date(d.at).toLocaleString('id-ID')}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Modal>
    </>
  );
}
