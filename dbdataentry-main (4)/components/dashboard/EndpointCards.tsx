'use client';
import { motion } from 'motion/react';
import { Check, Copy, Terminal, Webhook } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { copyText, useOrigin } from '@/lib/client';

function CopyCard({ icon, title, hint, value, loading, onResult }: { icon: React.ReactNode; title: string; hint: string; value: string; loading: boolean; onResult: (ok: boolean, label: string) => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const ok = await copyText(value);
    onResult(ok, title);
    if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1800); }
  };
  return (
    <motion.section whileHover={{ y: -2 }} transition={{ type: 'spring', stiffness: 400, damping: 30 }} className="glass glass-hover flex flex-col gap-3 p-5">
      <div className="flex items-center gap-2.5">
        <span className="grid size-9 place-items-center rounded-xl border border-cyan-300/25 bg-cyan-300/10 text-cyan-200">{icon}</span>
        <div><h3 className="text-sm font-semibold text-white">{title}</h3><p className="text-xs text-slate-400">{hint}</p></div>
      </div>
      {loading ? <Skeleton className="h-16" /> : (
        <div className="flex items-stretch gap-2">
          <code className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/40 px-3 py-2.5 font-mono text-xs leading-relaxed break-all text-cyan-100 select-all">{value}</code>
          <Button onClick={copy} variant={copied ? 'primary' : 'ghost'} aria-label={`Salin ${title}`} className="flex-none">
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}<span className="hidden sm:inline">{copied ? 'Disalin' : 'Salin'}</span>
          </Button>
        </div>
      )}
    </motion.section>
  );
}

// Alamat dibangun dari window.location.origin: tidak ada domain, token, atau API key di kode.
export function EndpointCards({ onResult }: { onResult: (ok: boolean, label: string) => void }) {
  const origin = useOrigin();
  const loading = origin === '';
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <CopyCard icon={<Webhook className="size-4" />} title="Universal Webhook Endpoint" hint="Terima JSON, form, atau teks dari sumber mana pun (POST)" value={`${origin}/api/receiver/universal`} loading={loading} onResult={onResult} />
      <CopyCard icon={<Terminal className="size-4" />} title="Loadstring Executor" hint="Tempel di executor untuk memantau status akun" value={`loadstring(game:HttpGet("${origin}/scripts/account_status.lua"))()`} loading={loading} onResult={onResult} />
    </div>
  );
}
