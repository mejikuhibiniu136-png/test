'use client';
import { useEffect } from 'react';
import { Button } from '@/components/ui/Button';

export default function ErrorPage({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <main className="grid min-h-dvh place-items-center p-4">
      <div className="glass max-w-sm space-y-4 p-7 text-center" role="alert">
        <h1 className="text-lg font-semibold text-white">Terjadi kesalahan</h1>
        <p className="text-sm text-slate-400">Halaman gagal dimuat. Data Anda aman; coba muat ulang.</p>
        <div className="flex justify-center gap-2">
          <Button variant="primary" onClick={() => reset()}>Coba lagi</Button>
          <Button onClick={() => { window.location.href = '/'; }}>Ke beranda</Button>
        </div>
      </div>
    </main>
  );
}
