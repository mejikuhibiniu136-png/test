export function Skeleton({ className = '', delay = 0 }: { className?: string; delay?: number }) {
  return <div className={`skeleton ${className}`} style={{ animationDelay: `${delay}ms` }} aria-hidden />;
}

export function SkeletonGrid({ count = 6, className = 'h-44' }: { count?: number; className?: string }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true" aria-label="Memuat data">
      {Array.from({ length: count }, (_, i) => <Skeleton key={i} className={className} delay={i * 80} />)}
    </div>
  );
}

export function SkeletonRows({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Memuat data">
      {Array.from({ length: count }, (_, i) => <Skeleton key={i} className="h-16" delay={i * 80} />)}
    </div>
  );
}

// Varian skeleton bertema: kerangka yang meniru bentuk konten asli supaya tata letak tidak melompat
// saat data tiba. `shimmer` = kilau bergerak (bawaan); `pulse` = berdenyut lembut.
export function SkeletonStat({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4" aria-busy="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="glass space-y-3 p-4"><Skeleton className="h-3 w-1/2" delay={i * 60} /><Skeleton className="h-8 w-2/3" delay={i * 60 + 40} /><Skeleton className="h-3 w-1/3" delay={i * 60 + 80} /></div>
      ))}
    </div>
  );
}

export function SkeletonTable({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="glass overflow-hidden p-3" aria-busy="true" aria-label="Memuat data">
      <Skeleton className="mb-3 h-4 w-1/4" />
      <div className="space-y-2.5">
        {Array.from({ length: rows }, (_, r) => (
          <div key={r} className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
            {Array.from({ length: cols }, (_, c) => <Skeleton key={c} className="h-8" delay={(r * cols + c) * 30} />)}
          </div>
        ))}
      </div>
    </div>
  );
}

export function SkeletonChart({ bars = 24 }: { bars?: number }) {
  return (
    <div className="glass flex h-48 items-end gap-1 p-4" aria-busy="true">
      {Array.from({ length: bars }, (_, i) => <div key={i} className="skeleton flex-1 rounded-t-md" style={{ height: `${28 + ((i * 37) % 62)}%`, animationDelay: `${i * 40}ms` }} aria-hidden />)}
    </div>
  );
}
