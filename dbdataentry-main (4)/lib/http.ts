// Helper HTTP untuk route handler.

export class HttpError extends Error {
  readonly status: number;
  readonly headers?: Record<string, string>;
  constructor(status: number, message: string, headers?: Record<string, string>) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.headers = headers;
  }
}

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

export const unauthorized = () => json({ success: false, message: 'Unauthorized' }, 401);
export const forbidden = () => json({ success: false, message: 'Hanya admin yang boleh melakukan aksi ini' }, 403);
export const forbiddenSuperadmin = () => json({ success: false, message: 'Hanya Superadmin yang boleh melakukan aksi ini' }, 403);

// Detail error asli hanya masuk log server; klien hanya menerima pesan umum.
export function errorResponse(err: unknown, context = 'api'): Response {
  if (err instanceof HttpError) {
    return json({ success: false, message: err.message }, err.status, err.headers);
  }
  console.error(`[${context}]`, err);
  return json({ success: false, message: 'Terjadi kesalahan pada server' }, 500);
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Item dari Redis bisa string JSON atau object (Upstash auto-deserialize). Rusak -> null.
export function parseStored<T = Record<string, unknown>>(item: unknown): T | null {
  if (typeof item === 'string') {
    try {
      const v = JSON.parse(item);
      return isPlainObject(v) ? (v as T) : null;
    } catch {
      return null;
    }
  }
  return isPlainObject(item) ? (item as T) : null;
}

// IP klien dari x-forwarded-for (diisi/ditimpa platform Vercel), cadangan x-real-ip.
export function getClientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  const raw = ((forwarded ? forwarded.split(',')[0] : '') || headers.get('x-real-ip') || 'unknown').trim();
  return raw.replace(/[^0-9a-fA-F:.]/g, '').slice(0, 45) || 'unknown';
}

export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number.parseInt(String(value), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

// Membaca JSON kecil (login, register, CRUD). Melempar HttpError 400/413.
export async function readJson(request: Request, maxBytes = 8 * 1024): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, 'Payload terlalu besar');
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new HttpError(400, 'Body harus berupa JSON yang valid');
  }
  if (!isPlainObject(value)) throw new HttpError(400, 'Body harus berupa object JSON');
  return value;
}
