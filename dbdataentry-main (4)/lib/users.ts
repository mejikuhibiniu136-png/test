// Akun pengguna dashboard & riwayat perangkat (namespace users:*).
// Tidak ada fungsi di sini (atau di modul log) yang menghapus users:* secara massal.
import { KEYS } from '@/lib/keys';
import { HttpError, parseStored } from '@/lib/http';
import { hashPassword } from '@/lib/auth/password';
import type { RedisLike } from '@/lib/redis';
import type { DeviceEntry, StorableRole, UserStatus, UserSummary } from '@/types';

export const MAX_DEVICE_HISTORY = 50;

export interface StoredUser {
  username: string;
  passwordHash: string;
  role: StorableRole;
  status: UserStatus;
  createdAt: string;
}

// Username tidak peka huruf besar/kecil: "Alice" dan "alice" adalah akun yang sama.
export const userKey = (username: string) => username.trim().toLowerCase();

export async function getUser(redis: RedisLike, username: string): Promise<StoredUser | null> {
  const raw = await redis.get(KEYS.userAccount(userKey(username)));
  const user = parseStored<StoredUser>(raw);
  if (!user || typeof user.passwordHash !== 'string') return null;
  // Akun dari sebelum sistem persetujuan ada (tanpa field status) dianggap sudah aktif.
  if (user.status !== 'pending' && user.status !== 'active' && user.status !== 'suspended' && user.status !== 'rejected') {
    user.status = 'active';
  }
  if (user.role !== 'admin' && user.role !== 'viewer') user.role = 'viewer';
  return user;
}

// SET NX membuat pendaftaran serentak dengan username sama hanya berhasil satu kali.
// Pendaftar baru SELALU mulai dari role 'viewer' dan status 'pending' (Sistem Persetujuan Akun Baru):
// baru bisa memakai dashboard setelah di-approve Superadmin.
export async function createUser(
  redis: RedisLike,
  username: string,
  password: string,
  reservedKeys: string[] = [],
  nowMs = Date.now()
): Promise<StoredUser> {
  const key = userKey(username);
  if (reservedKeys.includes(key)) throw new HttpError(409, 'Username tidak tersedia');

  const user: StoredUser = {
    username: username.trim(),
    passwordHash: await hashPassword(password),
    role: 'viewer',
    status: 'pending',
    createdAt: new Date(nowMs).toISOString(),
  };
  const created = await redis.set(KEYS.userAccount(key), JSON.stringify(user), { nx: true });
  if (!created) throw new HttpError(409, 'Username tidak tersedia');
  await redis.zadd(KEYS.usersList, { score: nowMs, member: key });
  return user;
}

// Superadmin: ubah role (admin/viewer) dan/atau status (approve/reject/suspend/aktifkan kembali).
export async function updateUser(
  redis: RedisLike,
  usernameKey: string,
  patch: { role?: StorableRole; status?: UserStatus }
): Promise<StoredUser> {
  const user = await getUser(redis, usernameKey);
  if (!user) throw new HttpError(404, 'Pengguna tidak ditemukan');
  const next: StoredUser = { ...user, ...patch };
  await redis.set(KEYS.userAccount(usernameKey), JSON.stringify(next));
  return next;
}


export async function recordDevice(redis: RedisLike, key: string, entry: DeviceEntry): Promise<void> {
  await redis.lpush(KEYS.userDevices(key), JSON.stringify(entry));
  await redis.ltrim(KEYS.userDevices(key), 0, MAX_DEVICE_HISTORY - 1);
}

export async function readDevices(redis: RedisLike, key: string, limit = MAX_DEVICE_HISTORY): Promise<DeviceEntry[]> {
  const raw = await redis.lrange(KEYS.userDevices(key), 0, Math.min(limit, MAX_DEVICE_HISTORY) - 1);
  return (raw ?? []).map((r) => parseStored<DeviceEntry>(r)).filter((d): d is DeviceEntry => d !== null);
}

// Daftar pengguna terdaftar + login terakhir. Admin (dari env) ditambahkan oleh pemanggil.
export async function listUsers(redis: RedisLike, limit = 200): Promise<UserSummary[]> {
  const keys = ((await redis.zrange(KEYS.usersList, 0, limit - 1, { rev: true })) ?? []).map(String);
  const rows = await Promise.all(
    keys.map(async (key) => {
      const [user, devices] = await Promise.all([
        redis.get(KEYS.userAccount(key)).then((r) => parseStored<StoredUser>(r)),
        readDevices(redis, key, 1),
      ]);
      if (!user) return null;
      return { username: user.username, role: user.role, status: user.status, createdAt: user.createdAt, lastLogin: devices[0] ?? null, immutable: false };
    })
  );
  return rows.filter((r): r is NonNullable<typeof r> => r !== null);
}
