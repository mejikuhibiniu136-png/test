// Jejak audit aksi sensitif (Superadmin + aksi destruktif staf). Disimpan di list `audit:log`
// (terbaru di depan, dipangkas ke AUDIT_MAX). Mencatat TIDAK PERNAH menggagalkan aksinya:
// error ditulis ke log server saja. Nilai rahasia tidak pernah dimasukkan ke entri.
import { randomUUID } from 'node:crypto';
import { getClientIp } from '@/lib/http';
import { KEYS } from '@/lib/keys';
import type { RedisLike } from '@/lib/redis';
import type { AuditAction, AuditEntry, SessionClaims } from '@/types';

export const AUDIT_MAX = 1000;

// Hapus karakter kontrol (mis. baris baru) dan batasi panjang: entri berasal dari input pengguna.
const clean = (v: string | undefined, max: number) => (v === undefined ? undefined : v.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max) || undefined);

export interface AuditInput {
  actor: string;
  role: string;
  action: AuditAction;
  target?: string;
  detail?: string;
  ip?: string;
}

export function actorOf(session: Pick<SessionClaims, 'sub' | 'role'>, headers: Headers): Pick<AuditInput, 'actor' | 'role' | 'ip'> {
  return { actor: session.sub, role: session.role, ip: getClientIp(headers) };
}

export async function recordAudit(redis: RedisLike, input: AuditInput, nowMs = Date.now()): Promise<void> {
  try {
    const entry: AuditEntry = {
      id: randomUUID(),
      at: new Date(nowMs).toISOString(),
      actor: clean(input.actor, 64) ?? 'unknown',
      role: clean(input.role, 16) ?? 'unknown',
      action: input.action,
      target: clean(input.target, 96),
      detail: clean(input.detail, 300),
      ip: clean(input.ip, 45),
    };
    await redis.lpush(KEYS.auditLog, JSON.stringify(entry));
    await redis.ltrim(KEYS.auditLog, 0, AUDIT_MAX - 1);
  } catch (err) {
    console.error('[audit] gagal mencatat:', err);
  }
}

export async function readAudit(redis: RedisLike, limit: number): Promise<AuditEntry[]> {
  const raw = await redis.lrange(KEYS.auditLog, 0, Math.max(1, limit) - 1);
  return (raw ?? [])
    .map((r) => {
      if (typeof r === 'string') {
        try { return JSON.parse(r) as AuditEntry; } catch { return null; }
      }
      return r && typeof r === 'object' ? (r as AuditEntry) : null;
    })
    .filter((e): e is AuditEntry => e !== null && typeof e.action === 'string');
}
