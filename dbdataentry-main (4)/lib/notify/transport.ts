// Pengirim HTTP dengan retry untuk platform notifikasi. Dirancang untuk serverless: total waktu
// dibatasi (timeout per percobaan + tunggu maksimum), dan tidak pernah memuat rahasia ke pesan galat.
import { redact } from '@/lib/notify/text';
import type { HttpRequestSpec } from '@/lib/notify/types';

export interface SendOutcome { ok: boolean; status: number | null; attempts: number; error?: string }

export interface TransportDeps {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export interface TransportOptions {
  maxAttempts?: number;
  timeoutMs?: number;
  maxWaitMs?: number;
  retryAfter: (status: number, headers: Headers, body: unknown) => number | null;
  secrets: string[];
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const retryable = (status: number) => status === 429 || status >= 500;

export async function sendWithRetry(spec: HttpRequestSpec, opts: TransportOptions, deps: TransportDeps = {}): Promise<SendOutcome> {
  const doFetch = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? defaultSleep;
  const random = deps.random ?? Math.random;
  const max = opts.maxAttempts ?? 3;
  let last: SendOutcome = { ok: false, status: null, attempts: 0, error: 'tidak terkirim' };

  for (let attempt = 1; attempt <= max; attempt += 1) {
    let wait = Math.min(2000, 300 * 2 ** (attempt - 1)) * (0.5 + random() * 0.5); // backoff eksponensial + jitter
    try {
      const res = await doFetch(spec.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(spec.body),
        redirect: 'error', // jangan ikuti redirect ke host lain
        cache: 'no-store',
        signal: AbortSignal.timeout(opts.timeoutMs ?? 5000),
      });
      if (res.ok) return { ok: true, status: res.status, attempts: attempt };
      const body = await res.json().catch(() => null);
      last = { ok: false, status: res.status, attempts: attempt, error: redact(`HTTP ${res.status}`, opts.secrets) };
      if (!retryable(res.status)) return last;
      const asked = opts.retryAfter(res.status, res.headers, body);
      if (asked !== null) wait = Math.max(wait, asked * 1000);
    } catch (err) {
      const name = err instanceof Error ? err.name : 'Error';
      last = { ok: false, status: null, attempts: attempt, error: redact(name === 'TimeoutError' ? 'timeout' : 'galat jaringan', opts.secrets) };
    }
    if (attempt < max) {
      if (wait > (opts.maxWaitMs ?? 4000)) return last; // platform meminta tunggu terlalu lama untuk serverless: menyerah
      await sleep(wait);
    }
  }
  return last;
}
