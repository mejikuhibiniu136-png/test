import { actorOf, recordAudit } from '@/lib/audit';
import { errorResponse, json } from '@/lib/http';
import { emitAlert } from '@/lib/notify/emit';
import { can } from '@/lib/rbac/permissions';
import { requirePermission } from '@/lib/rbac/guard';
import { getRedis } from '@/lib/redis';
import { findSession, isSid, listAllSessions, listSessionsOf, revokeAllForUser, revokeSession } from '@/lib/sessions';

export const dynamic = 'force-dynamic';

// GET /api/sessions            sesi milik sendiri
// GET /api/sessions?scope=all  semua pengguna (izin sessions:read:all, Super Admin)
export async function GET(request: Request) {
  try {
    const { session, denied } = await requirePermission('sessions:read:own');
    if (denied) return denied;
    const redis = getRedis();
    const all = new URL(request.url).searchParams.get('scope') === 'all';
    if (all && !can(session.role, 'sessions:read:all')) return json({ success: false, message: 'Anda tidak memiliki izin untuk aksi ini' }, 403);
    const data = all ? await listAllSessions(redis, session.sid) : await listSessionsOf(redis, session.sub, session.sid);
    return json({ success: true, data, canRevokeAny: can(session.role, 'sessions:revoke:any') });
  } catch (err) {
    return errorResponse(err, 'sessions GET');
  }
}

// DELETE ?sid=<id>              cabut satu sesi (milik sendiri, atau siapa pun bila sessions:revoke:any)
// DELETE ?scope=others          cabut semua sesi sendiri kecuali yang sedang dipakai
// DELETE ?user=<nama>&all=1     cabut semua sesi satu pengguna (sessions:revoke:any)
export async function DELETE(request: Request) {
  try {
    const { session, denied } = await requirePermission('sessions:revoke:own');
    if (denied) return denied;
    const redis = getRedis();
    const params = new URL(request.url).searchParams;
    const any = can(session.role, 'sessions:revoke:any');
    const ctx = actorOf(session, request.headers);

    if (params.get('scope') === 'others') {
      const n = await revokeAllForUser(redis, session.sub, session.sid);
      await recordAudit(redis, { ...ctx, action: 'session.revoke', target: session.sub, detail: `${n} sesi lain dicabut` });
      return json({ success: true, revoked: n });
    }

    const user = params.get('user');
    if (user && params.get('all') === '1') {
      if (!any && user.toLowerCase() !== session.sub.toLowerCase()) return json({ success: false, message: 'Anda tidak memiliki izin untuk aksi ini' }, 403);
      const n = await revokeAllForUser(redis, user, user.toLowerCase() === session.sub.toLowerCase() ? session.sid : '');
      await recordAudit(redis, { ...ctx, action: 'session.revoke', target: user, detail: `${n} sesi dicabut` });
      if (user.toLowerCase() !== session.sub.toLowerCase()) await emitAlert({ kind: 'session.revoked', severity: 'info', title: `Semua sesi ${user} dicabut`, message: `${session.sub} mencabut ${n} sesi.`, fields: [{ name: 'Oleh', value: session.sub }] }, { redis });
      return json({ success: true, revoked: n });
    }

    const sid = params.get('sid');
    if (!isSid(sid)) return json({ success: false, message: 'Parameter sid tidak valid' }, 400);
    const target = await findSession(redis, sid);
    if (!target) return json({ success: false, message: 'Sesi tidak ditemukan atau sudah berakhir' }, 404);
    const mine = target.username.toLowerCase() === session.sub.toLowerCase();
    if (!mine && !any) return json({ success: false, message: 'Anda tidak memiliki izin untuk aksi ini' }, 403);
    await revokeSession(redis, target.username, sid);
    await recordAudit(redis, { ...ctx, action: 'session.revoke', target: target.username, detail: `sid ${sid.slice(0, 8)}… (${target.browser}/${target.os}, ${target.ip})` });
    if (!mine) await emitAlert({ kind: 'session.revoked', severity: 'info', title: `Sesi ${target.username} dicabut`, message: `${session.sub} mencabut satu sesi.`, fields: [{ name: 'IP sesi', value: target.ip }, { name: 'Oleh', value: session.sub }] }, { redis });
    return json({ success: true, revoked: 1 });
  } catch (err) {
    return errorResponse(err, 'sessions DELETE');
  }
}
