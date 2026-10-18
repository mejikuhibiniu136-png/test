import type { ReactNode } from 'react';

// Penjelasan lipat di bawah tabel/panel. Gaya mengikuti blok "Cara memutar kunci" di EncryptionPanel
// (token warna slate yang sudah ada, tanpa token baru). <details> bawaan browser: bisa dibuka lewat
// keyboard dan terbaca pembaca layar tanpa JavaScript tambahan.
export function Explainer({ title, items, ordered = false, className = '' }: { title: string; items: ReactNode[]; ordered?: boolean; className?: string }) {
  const List = ordered ? 'ol' : 'ul';
  return (
    <details className={`text-xs leading-relaxed text-slate-400 ${className}`}>
      <summary className="cursor-pointer text-slate-300">{title}</summary>
      <List className={`mt-2 space-y-1.5 pl-5 ${ordered ? 'list-decimal' : 'list-disc'}`}>
        {items.map((item, i) => <li key={i}>{item}</li>)}
      </List>
    </details>
  );
}
