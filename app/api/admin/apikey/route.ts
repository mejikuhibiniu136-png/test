import { actorOf, recordAudit } from '@/lib/audit';
import { createApiKey, listApiKeys, revokeApiKey } from '@/lib/apikeys';
import { requireSuperadmin } from '@/lib/auth/session';
import { HttpError, errorResponse, json, readJson } from '@/lib/http';
import { KEYS } from '@/lib/keys';
import { getRedis } from '@/lib/redis';
import { apiKeyCreateSchema } from '@/schemas/admin';

export const dynamic = 'force-dynamic';

// Superadmin: daftar API Key (tanpa nilai kunci; hanya penanda, label, kedaluwarsa, terakhir dipakai).
export async function GET() {
  try {
    const { denied } = await requireSuperadmin();
    if (denied) return denied;
    return json({ success: true, data: await listApiKeys(getRedis()) });
  } catch (err) {
    return errorResponse(err, 'admin/apikey GET');
  }
}

// Superadmin: buat API Key baru (key lain tetap berlaku). Nilai kunci HANYA dikembalikan sekali
// di response ini; di Redis hanya tersimpan hash-nya.
export async function POST(request: Request) {
  try {
    const { session, denied } = await requireSuperadmin();
    if (denied) return denied;
    const parsed = apiKeyCreateSchema.safeParse(await readJson(request, 1024));
    if (!parsed.success) return json({ success: false, message: parsed.error.issues[0]?.message ?? 'Data tidak valid' }, 400);

    const redis = getRedis();
    const { key, view } = await createApiKey(redis, { ...parsed.data, by: session.sub });
    // Satu API Key tunggal versi lama tidak pernah dipakai untuk verifikasi; dibersihkan agar tidak menggantung.
    await redis.hdel(KEYS.settings, 'API_KEY');
    await recordAudit(redis, {
      ...actorOf(session, request.headers),
      action: 'apikey.create',
      target: `${view.label} (${view.id})`,
      detail: view.expiresAt ? `kedaluwarsa ${view.expiresAt}` : 'tanpa kedaluwarsa',
    });
    return json({ success: true, apiKey: key, data: view }, 201);
  } catch (err) {
    return errorResponse(err, 'admin/apikey POST');
  }
}

// Superadmin: cabut satu API Key. ?id=<id dari daftar>
export async function DELETE(request: Request) {
  try {
    const { session, denied } = await requireSuperadmin();
    if (denied) return denied;
    const id = new URL(request.url).searchParams.get('id') ?? '';
    if (!/^[0-9a-f]{12}$/.test(id)) throw new HttpError(400, 'Parameter id tidak valid');
    const redis = getRedis();
    const label = (await listApiKeys(redis)).find((k) => k.id === id)?.label;
    if (!(await revokeApiKey(redis, id))) throw new HttpError(404, 'API Key tidak ditemukan');
    await recordAudit(redis, { ...actorOf(session, request.headers), action: 'apikey.revoke', target: `${label ?? '?'} (${id})` });
    return json({ success: true });
  } catch (err) {
    return errorResponse(err, 'admin/apikey DELETE');
  }
}
