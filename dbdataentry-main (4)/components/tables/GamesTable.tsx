'use client';
import { motion } from 'motion/react';
import { ArrowUpRight, Pencil, Trash2 } from 'lucide-react';
import { AnimatedNumber } from '@/components/ui/AnimatedNumber';
import { Button } from '@/components/ui/Button';
import { Pill } from '@/components/ui/Pill';
import type { GameTable } from '@/types';

const SOURCE = { builtin: { label: 'Bawaan', tone: 'violet' }, auto: { label: 'Otomatis', tone: 'accent' }, manual: { label: 'Manual', tone: 'neutral' } } as const;

export function GamesTable({ games, isAdmin, onOpen, onRename, onDelete }: { games: GameTable[]; isAdmin: boolean; onOpen: (g: GameTable) => void; onRename: (g: GameTable) => void; onDelete: (g: GameTable) => void }) {
  if (!games.length) return <div className="glass p-8 text-center text-sm text-slate-500">Belum ada tabel. Tabel dibuat otomatis saat webhook pertama dari sebuah game/sumber masuk.</div>;
  return (
    <div className="glass overflow-x-auto">
      <table className="w-full min-w-[40rem] text-left text-sm">
        <caption className="sr-only">Daftar tabel game</caption>
        <thead className="border-b border-white/10 text-xs text-slate-400">
          <tr><th scope="col" className="px-4 py-3 font-medium">Tabel</th><th scope="col" className="px-4 py-3 font-medium">Asal</th><th scope="col" className="px-4 py-3 text-right font-medium">Log diterima</th><th scope="col" className="px-4 py-3 font-medium">Dibuat</th><th scope="col" className="px-4 py-3"><span className="sr-only">Aksi</span></th></tr>
        </thead>
        <tbody>
          {games.map((g) => (
            <motion.tr key={g.slug} layout="position" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="border-b border-white/5 last:border-0 hover:bg-white/[0.03]">
              <td className="px-4 py-3"><div className="font-medium text-white">{g.name}</div><div className="font-mono text-[11px] text-slate-500">game:{g.slug}:logs</div></td>
              <td className="px-4 py-3"><Pill tone={SOURCE[g.source].tone}>{SOURCE[g.source].label}</Pill></td>
              <td className="px-4 py-3 text-right font-semibold text-white"><AnimatedNumber value={g.total} /></td>
              <td className="px-4 py-3 text-xs text-slate-400">{new Date(g.createdAt).toLocaleDateString('id-ID')}{g.createdBy ? ` · ${g.createdBy}` : ''}</td>
              <td className="px-4 py-3"><div className="flex justify-end gap-1.5">
                <Button size="sm" onClick={() => onOpen(g)}>Buka<ArrowUpRight className="size-3.5" /></Button>
                {isAdmin && !g.builtin && <Button size="sm" onClick={() => onRename(g)} aria-label={`Ganti nama ${g.name}`}><Pencil className="size-3.5" /></Button>}
                {isAdmin && !g.builtin && <Button size="sm" variant="danger" onClick={() => onDelete(g)} aria-label={`Hapus ${g.name}`}><Trash2 className="size-3.5" /></Button>}
              </div></td>
            </motion.tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
