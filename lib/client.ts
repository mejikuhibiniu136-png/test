'use client';
// Helper sisi browser.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { StreamPayload } from '@/types';

// Semua request dashboard lewat sini: sesi berakhir (401) -> kembali ke login.
export async function apiFetch(url: string, options?: RequestInit): Promise<Response> {
  const res = await fetch(url, options);
  if (res.status === 401) {
    window.location.href = '/login';
    throw new Error('Sesi berakhir');
  }
  return res;
}

export async function apiJson<T = Record<string, unknown>>(url: string, method: string, body?: unknown): Promise<T & { success?: boolean; message?: string }> {
  const res = await apiFetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw new Error(data.message || `Permintaan gagal (${res.status})`);
  return data;
}

export function downloadText(filename: string, text: string, mime = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Cadangan untuk konteks non-HTTPS / izin clipboard ditolak.
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function safeImageUrl(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

export const embedColor = (c: unknown) => (Number.isInteger(c) && (c as number) > 0 && (c as number) <= 0xffffff ? `#${(c as number).toString(16).padStart(6, '0')}` : '#eab308');

// Origin aktif (window.location.origin). Kosong saat render server agar tidak terjadi hydration mismatch.
export function useOrigin(): string {
  const [origin, setOrigin] = useState('');
  useEffect(() => setOrigin(window.location.origin), []);
  return origin;
}

// ---------- Toast ----------
export interface Toast { id: number; message: string; type: 'success' | 'error' | 'info' }

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const counter = useRef(0);

  const dismiss = useCallback((id: number) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts((l) => l.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((message: string, type: Toast['type'] = 'info') => {
    counter.current += 1;
    const id = counter.current;
    setToasts((l) => [...l.slice(-3), { id, message, type }]);
    timers.current.set(id, setTimeout(() => dismiss(id), 4000));
  }, [dismiss]);

  useEffect(() => {
    const current = timers.current;
    return () => current.forEach((t) => clearTimeout(t));
  }, []);
  return { toasts, push };
}

// ---------- SSE ----------
export type Connection = 'connecting' | 'live' | 'reconnecting' | 'paused';

// Stream ditutup saat tab tersembunyi atau dijeda (hemat command Redis) lalu disambung otomatis.
export function useLiveStream({ paused, game, limit, onData }: { paused: boolean; game: string; limit: number; onData: (d: StreamPayload) => void }): Connection {
  const [status, setStatus] = useState<Connection>('connecting');
  const cb = useRef(onData);
  useEffect(() => { cb.current = onData; }, [onData]);

  useEffect(() => {
    if (paused) { setStatus('paused'); return undefined; }
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let warn: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;

    const disconnect = () => {
      clearTimeout(retry); clearTimeout(warn);
      source?.close();
      source = null;
    };
    const scheduleRetry = () => { if (!disposed && !document.hidden) retry = setTimeout(connect, 5000); };

    function connect() {
      if (disposed || source) return;
      setStatus((s) => (s === 'live' ? s : 'connecting'));
      const es = new EventSource(`/api/stream?game=${encodeURIComponent(game)}&limit=${limit}`);
      source = es;
      es.onopen = () => { clearTimeout(warn); setStatus('live'); };
      es.onmessage = (e) => {
        try {
          clearTimeout(warn);
          setStatus('live');
          cb.current(JSON.parse(e.data) as StreamPayload);
        } catch (err) { console.error('SSE', err); }
      };
      es.onerror = () => {
        clearTimeout(warn);
        warn = setTimeout(() => setStatus('reconnecting'), 6000);
        if (es.readyState !== EventSource.CLOSED) return; // server menutup tiap ~55 dtk; browser menyambung sendiri
        es.close();
        if (source === es) source = null;
        fetch('/api/auth/me').then((r) => { if (r.status === 401) window.location.href = '/login'; else scheduleRetry(); }).catch(scheduleRetry);
      };
    }

    const onVisibility = () => (document.hidden ? disconnect() : connect());
    document.addEventListener('visibilitychange', onVisibility);
    if (!document.hidden) connect();
    return () => { disposed = true; document.removeEventListener('visibilitychange', onVisibility); disconnect(); };
  }, [paused, game, limit]);

  return status;
}
