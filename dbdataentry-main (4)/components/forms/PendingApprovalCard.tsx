'use client';
import { motion } from 'motion/react';
import { Clock3, LogOut, ShieldAlert } from 'lucide-react';
import { useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import type { UserStatus } from '@/types';

const COPY: Record<UserStatus, { title: string; body: string; icon: typeof Clock3 }> = {
  pending: {
    title: 'Menunggu Persetujuan Superadmin',
    body: 'Akun Anda sudah terdaftar dan sedang menunggu persetujuan Superadmin. Halaman ini akan otomatis beralih begitu akun disetujui.',
    icon: Clock3,
  },
  suspended: {
    title: 'Akun Ditangguhkan',
    body: 'Akses akun ini sedang ditangguhkan oleh Superadmin. Hubungi Superadmin bila ini keliru.',
    icon: ShieldAlert,
  },
  rejected: {
    title: 'Pendaftaran Ditolak',
    body: 'Pendaftaran akun ini ditolak oleh Superadmin. Hubungi Superadmin bila ini keliru.',
    icon: ShieldAlert,
  },
  active: { title: 'Akun Aktif', body: 'Mengalihkan ke dashboard…', icon: Clock3 },
};

export function PendingApprovalCard({ username, status }: { username: string; status: UserStatus }) {
  const { title, body, icon: Icon } = COPY[status];

  // Poling ringan: begitu Superadmin approve, pengguna otomatis masuk tanpa perlu login ulang.
  useEffect(() => {
    if (status !== 'pending') return undefined;
    const t = setInterval(() => {
      fetch('/api/auth/me')
        .then((r) => r.json())
        .then((d) => { if (d?.status === 'active' || d?.role === 'superadmin') window.location.href = '/'; })
        .catch(() => undefined);
    }, 8000);
    return () => clearInterval(t);
  }, [status]);

  const logout = async () => { await fetch('/api/auth/logout', { method: 'POST' }); window.location.href = '/login'; };

  return (
    <main className="grid min-h-dvh place-items-center p-4">
      <motion.div className="glass w-full max-w-md space-y-5 p-7 text-center" initial={{ opacity: 0, y: 20, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 26 }}>
        <div className="mx-auto grid size-14 place-items-center rounded-2xl border border-amber-300/30 bg-amber-300/10 text-amber-200 shadow-[0_0_32px_-6px_rgb(251_191_36/0.6)]">
          <Icon className="size-7" aria-hidden />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-white">{title}</h1>
          <p className="mt-1 text-sm text-slate-400">Halo, {username}</p>
        </div>
        <p className="text-sm leading-relaxed text-slate-300">{body}</p>
        <Button onClick={logout} className="mx-auto w-full py-2.5"><LogOut className="size-4" />Keluar</Button>
      </motion.div>
    </main>
  );
}
