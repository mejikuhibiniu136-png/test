'use client';
import { AnimatePresence, motion } from 'motion/react';
import { Check, Copy, Download, X, Zap } from 'lucide-react';
import { Component, Fragment, memo, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { Pill } from '@/components/ui/Pill';
import { useEscape } from '@/components/ui/Modal';
import { embedColor, safeImageUrl } from '@/lib/client';
import { eventLabel, hasEmbeds, isHeartbeat, str } from '@/lib/logStats';
import type { LogEntry } from '@/types';

const TOKEN = /("(?:\\.|[^"\\])*"(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
const MAX_CHARS = 120_000;

// JSON berwarna, dirender sebagai elemen React (bukan innerHTML).
export function JsonView({ value }: { value: unknown }) {
  let text: string;
  try { text = JSON.stringify(value, null, 2) ?? 'undefined'; } catch { text = String(value); }
  const truncated = text.length > MAX_CHARS;
  if (truncated) text = text.slice(0, MAX_CHARS);
  const parts: (string | { cls: string; token: string })[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const t = m[0];
    const cls = m[2] ? 'json-key' : t.startsWith('"') ? 'json-str' : t === 'true' || t === 'false' ? 'json-bool' : t === 'null' ? 'json-null' : 'json-num';
    parts.push({ cls, token: t });
    last = m.index + t.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return (
    <pre className="max-h-96 overflow-auto rounded-xl bg-black/40 p-3 font-mono text-xs leading-relaxed text-slate-300">
      {parts.map((p, i) => (typeof p === 'string' ? <Fragment key={i}>{p}</Fragment> : <span key={i} className={p.cls}>{p.token}</span>))}
      {truncated ? '\n… (dipotong, gunakan Unduh untuk data lengkap)' : ''}
    </pre>
  );
}

// Log dengan format tak terduga tidak boleh merusak seluruh halaman.
export class LogBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e: unknown) { console.error('Gagal merender log:', e); }
  render() {
    return this.state.failed ? <div className="rounded-xl border border-rose-400/30 bg-rose-400/10 p-3 text-sm text-rose-200">Log ini tidak dapat ditampilkan (format payload tidak valid).</div> : this.props.children;
  }
}

const fmtDate = (v: string) => { const d = new Date(v); return Number.isNaN(d.getTime()) ? '-' : d.toLocaleString('id-ID'); };

interface CardProps { log: LogEntry; isNew: boolean; copied: boolean; showGame: boolean; onOpen: (l: LogEntry) => void; onCopy: (l: LogEntry) => void }

function LogCardInner({ log, isNew, copied, showGame, onOpen, onCopy }: CardProps) {
  const p = log.payload ?? {};
  const rawEmbed = Array.isArray(p.embeds) ? p.embeds[0] : null;
  const embed = rawEmbed && (str(rawEmbed.title) || str(rawEmbed.description) || str(rawEmbed.author?.name)) ? rawEmbed : null;
  const who = str(p.displayName) || str(p.username);
  const heartbeat = isHeartbeat(log);
  const text = str(p.content) || str(p.text) || str(p.message);

  return (
    <motion.article layout="position" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}
      className={`glass glass-hover p-4 ${isNew ? 'border-cyan-300/50 shadow-[0_0_24px_-8px_rgb(34_211_238/0.6)]' : ''}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Pill tone={heartbeat ? 'ok' : hasEmbeds(log) ? 'violet' : 'accent'} dot={heartbeat ? 'live' : undefined}>{eventLabel(log)}</Pill>
          {showGame && <span className="text-xs font-semibold text-cyan-300">{log.gameName}</span>}
          {who && <span className="truncate text-sm font-medium text-white">{who}</span>}
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden items-center gap-1 font-mono text-[11px] text-cyan-300 sm:inline-flex"><Zap className="size-3" aria-hidden />{Number(log.processingTimeMs) || 0}ms</span>
          <time className="text-xs text-slate-500" dateTime={log.receivedAt}>{fmtDate(log.receivedAt)}</time>
          <Button size="sm" onClick={() => onCopy(log)}>{copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}{copied ? 'Disalin' : 'JSON'}</Button>
          <Button size="sm" onClick={() => onOpen(log)}>Detail</Button>
        </div>
      </div>

      {!heartbeat && embed && (
        <div className="mt-3 rounded-xl border-l-4 bg-black/25 p-3" style={{ borderLeftColor: embedColor(embed.color) }}>
          <div className="flex justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-white">{str(embed.title)}</h3>
              {str(embed.author?.name) && <div className="text-xs text-slate-400">{str(embed.author.name)}</div>}
            </div>
            {safeImageUrl(embed.thumbnail?.url) && /* eslint-disable-next-line @next/next/no-img-element */ <img src={safeImageUrl(embed.thumbnail.url)!} alt="" referrerPolicy="no-referrer" loading="lazy" className="size-12 flex-none rounded-lg object-cover" />}
          </div>
          {str(embed.description) && <div className="mt-2 text-sm whitespace-pre-wrap text-slate-300">{str(embed.description).replace(/\*\*/g, '')}</div>}
        </div>
      )}

      {!heartbeat && !embed && text && <p className="mt-3 text-sm whitespace-pre-wrap text-amber-200/90">{text.replace(/\|\|/g, '').slice(0, 400)}</p>}
      {!heartbeat && !embed && !text && <div className="mt-3"><JsonView value={log.payload} /></div>}
    </motion.article>
  );
}
export const LogCard = memo(LogCardInner);

export function LogDrawer({ log, onClose, onCopy, onDownload }: { log: LogEntry | null; onClose: () => void; onCopy: (l: LogEntry) => void; onDownload: (l: LogEntry) => void }) {
  useEscape(Boolean(log), onClose);
  return (
    <AnimatePresence>
      {log && (
        <motion.div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
          <motion.aside role="dialog" aria-modal="true" aria-label="Detail log" className="glass h-full w-full max-w-xl overflow-y-auto rounded-r-none border-r-0 p-5" initial={{ x: 80, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 80, opacity: 0 }} transition={{ type: 'spring', stiffness: 360, damping: 34 }}>
            <div className="mb-4 flex items-center justify-between gap-2">
              <h3 className="truncate text-lg font-semibold text-white">{eventLabel(log)}</h3>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => onCopy(log)}><Copy className="size-3.5" />Salin</Button>
                <Button size="sm" onClick={() => onDownload(log)}><Download className="size-3.5" />Unduh</Button>
                <Button size="sm" onClick={onClose} aria-label="Tutup"><X className="size-3.5" /></Button>
              </div>
            </div>
            <dl className="mb-4 grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2 rounded-xl bg-black/25 p-3 text-sm">
              {([['ID log', log.id], ['Tabel', log.gameName], ['Diterima', fmtDate(log.receivedAt)], ['Diproses', `${log.processingTimeMs} ms`], ['Format', `${log.format} · ${log.bytes} byte`], ['Jenis', log.eventType]] as const).map(([k, v]) => (
                <Fragment key={k}><dt className="text-slate-500">{k}</dt><dd className="break-all text-slate-200">{v}</dd></Fragment>
              ))}
            </dl>
            <JsonView value={log.payload} />
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
