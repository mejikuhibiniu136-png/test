'use client';
import { Download, Plus } from 'lucide-react';
import { GamesTable } from '@/components/tables/GamesTable';
import { Button } from '@/components/ui/Button';
import { Explainer } from '@/components/ui/Explainer';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { downloadText } from '@/lib/client';
import { gamesToCsv } from '@/lib/logStats';
import type { GameTable } from '@/types';

export function GamesView({ loading, games, isAdmin, onCreate, onOpen, onRename, onDelete }: { loading: boolean; games: GameTable[]; isAdmin: boolean; onCreate: () => void; onOpen: (g: GameTable) => void; onRename: (g: GameTable) => void; onDelete: (g: GameTable) => void }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-slate-400">Setiap game atau sumber webhook punya tabelnya sendiri. Tabel baru dibuat otomatis saat sumber baru terdeteksi dari <code className="font-mono text-slate-300">game_name</code>, <code className="font-mono text-slate-300">game_id</code>, <code className="font-mono text-slate-300">source</code>, dan kunci serupa.</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={!games.length} onClick={() => downloadText('games.csv', gamesToCsv(games), 'text/csv')}><Download className="size-3.5" />CSV</Button>
          <Button size="sm" disabled={!games.length} onClick={() => downloadText('games.json', JSON.stringify(games, null, 2), 'application/json')}><Download className="size-3.5" />JSON</Button>
          {isAdmin && <Button variant="primary" onClick={onCreate}><Plus className="size-4" />Tabel baru</Button>}
        </div>
      </div>
      {loading ? <SkeletonRows count={4} /> : <GamesTable games={games} isAdmin={isAdmin} onOpen={onOpen} onRename={onRename} onDelete={onDelete} />}
      <Explainer title="Cara membaca tabel ini" items={[
        <>Satu baris adalah satu tabel log milik satu game atau sumber webhook. Kunci Redis-nya tampil di bawah nama, misalnya <code className="text-slate-300">game:&lt;slug&gt;:logs</code>.</>,
        'Asal: Bawaan adalah tabel sistem. Otomatis dibuat saat webhook pertama dari sumber baru masuk. Manual dibuat admin lewat tombol "Tabel baru".',
        'Log diterima adalah jumlah log yang tercatat di tabel itu. Tombol "Buka" menampilkan log tabel tersebut.',
        'Ganti nama dan Hapus hanya untuk admin dan tidak tersedia untuk tabel bawaan. Menghapus tabel juga menghapus semua log di dalamnya dan tidak bisa dibatalkan.',
      ]} />
    </div>
  );
}
