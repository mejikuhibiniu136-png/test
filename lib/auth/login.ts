// Logika login/registrasi (dipisah dari route agar bisa diuji tanpa Next).
import { randomUUID } from 'node:crypto';
import { createHash, timingSafeEqual } from 'node:crypto';
import { buildDeviceEntry } from '@/lib/device';
import { ConfigError, getJwtSecret, getSuperadminConfig } from '@/lib/env';
import { HttpError, getClientIp } from '@/lib/http';
import { KEYS } from '@/lib/keys';
import { hitRateLimit, resetRateLimit } from '@/lib/rateLimit';
import type { RedisLike } from '@/lib/redis';
import { signSession } from '@/lib/auth/jwt';
import { verifyAgainstDummy, verifyPassword } from '@/lib/auth/password';
import { emitAlert } from '@/lib/notify/emit';
import { recordFromDevice, registerSession } from '@/lib/sessions';
import { createUser, getUser, readDevices, recordDevice, userKey } from '@/lib/users';
import type { Role, UserStatus } from '@/types';

const sha = (s: string) => createHash('sha256').update(s).digest();
const safeEqualText = (a: string, b: string) => timingSafeEqual(sha(a), sha(b));

const IP_LIMIT = { limit: 20, windowSeconds: 15 * 60 };
const USER_LIMIT = { limit: 5, windowSeconds: 15 * 60 };
const REGISTER_LIMIT = { limit: 5, windowSeconds: 60 * 60 };

export interface LoginResult {
  token: string;
  username: string;
  role: Role;
  status: UserStatus;
}

const BAD_LOGIN = new HttpError(401, 'Username atau password salah');

export async function performLogin(
  redis: RedisLike | null,
  headers: Headers,
  username: string,
  password: string
): Promise<LoginResult> {
  let superadmin;
  let secret;
  try {
    superadmin = getSuperadminConfig();
    secret = getJwtSecret();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error('[login] konfigurasi belum lengkap:', err.message);
      throw new HttpError(503, 'Server belum dikonfigurasi. Superadmin: lengkapi Environment Variables di Vercel.');
    }
    throw err;
  }

  const ip = getClientIp(headers);
  const lowered = userKey(username);
  const ipKey = KEYS.rateLimit('login-ip', ip);
  const userRateKey = KEYS.rateLimit('login-user', createHash('sha256').update(lowered).digest('hex').slice(0, 24));

  // Pembatas laju per IP dan per username. Redis bermasalah: login admin tetap boleh berjalan.
  if (redis) {
    try {
      for (const [key, rule] of [[ipKey, IP_LIMIT], [userRateKey, USER_LIMIT]] as const) {
        const r = await hitRateLimit(redis, key, rule);
        if (!r.allowed) {
          throw new HttpError(429, `Terlalu banyak percobaan login. Coba lagi dalam ${Math.ceil(r.retryAfterSeconds / 60)} menit.`, {
            'Retry-After': String(r.retryAfterSeconds),
          });
        }
      }
    } catch (err) {
      if (err instanceof HttpError) throw err;
      console.error('[login] rate limit tidak dapat diperiksa:', err);
    }
  }

  // Verifikasi hash selalu dijalankan sekali agar waktu respons tidak membocorkan username valid.
  let role: Role | null = null;
  let status: UserStatus = 'active';
  let canonical = username.trim();
  const isSuperadminName = safeEqualText(lowered, userKey(superadmin.username));

  if (isSuperadminName) {
    if (await verifyPassword(superadmin.passwordHash, password)) {
      role = 'superadmin'; // Superadmin: role permanen, tidak bisa diubah/ditangguhkan dari dashboard
      status = 'active';
      canonical = superadmin.username;
    }
  } else if (redis) {
    const user = await getUser(redis, username);
    if (user) {
      if (await verifyPassword(user.passwordHash, password)) {
        // Akun ditolak/ditangguhkan Superadmin: login ditolak sepenuhnya, bukan sekadar dibatasi.
        if (user.status === 'rejected' || user.status === 'suspended') {
          throw new HttpError(403, user.status === 'rejected'
            ? 'Pendaftaran Anda ditolak oleh Superadmin.'
            : 'Akun Anda ditangguhkan oleh Superadmin.');
        }
        role = user.role;
        status = user.status; // 'pending' tetap boleh login; proxy mengarahkan ke /pending-approval
        canonical = user.username;
      }
    } else {
      await verifyAgainstDummy(password);
    }
  } else {
    await verifyAgainstDummy(password);
  }
  if (!role) throw BAD_LOGIN;

  if (redis) {
    await Promise.all([resetRateLimit(redis, userRateKey), resetRateLimit(redis, ipKey)]).catch(() => undefined);
  }

  // Riwayat perangkat/IP disimpan di Redis untuk dipantau admin. Gagal mencatat tidak menggagalkan login.
  const sid = randomUUID();
  if (redis) {
    try {
      const key = userKey(canonical);
      const prior = await readDevices(redis, key);
      const entry = await buildDeviceEntry(headers, sid);
      await recordDevice(redis, key, entry);
      await registerSession(redis, recordFromDevice(canonical, role, entry));
      // Alert hanya bila pengguna sudah punya riwayat dan IP ini belum pernah dipakai (login pertama bukan "IP baru").
      if (prior.length > 0 && !prior.some((d) => d.ip === entry.ip)) {
        await emitAlert({
          kind: 'auth.new_ip', severity: role === 'superadmin' ? 'critical' : 'warning',
          title: `Login dari IP baru: ${canonical}`, message: `${canonical} (${role}) masuk dari alamat yang belum pernah dipakai sebelumnya.`,
          fields: [{ name: 'IP', value: entry.ip }, { name: 'Perangkat', value: `${entry.browser} / ${entry.os}` }, { name: 'Lokasi', value: [entry.city, entry.country].filter(Boolean).join(', ') || '-' }],
          dedupeKey: `${key}|${entry.ip}`,
        }, { redis });
      }
    } catch (err) {
      console.error('[login] gagal mencatat perangkat/sesi:', err);
    }
  }

  return { token: await signSession({ sub: canonical, role, status, sid }, secret), username: canonical, role, status };
}

export async function performRegister(redis: RedisLike, headers: Headers, username: string, password: string) {
  const rate = await hitRateLimit(redis, KEYS.rateLimit('register', getClientIp(headers)), REGISTER_LIMIT);
  if (!rate.allowed) {
    throw new HttpError(429, 'Terlalu banyak pendaftaran dari alamat ini. Coba lagi nanti.', {
      'Retry-After': String(rate.retryAfterSeconds),
    });
  }
  let reserved: string[] = [];
  try {
    reserved = [userKey(getSuperadminConfig().username)];
  } catch {
    // superadmin belum dikonfigurasi: tidak ada nama yang perlu dicadangkan
  }
  const user = await createUser(redis, username, password, reserved);
  await emitAlert({
    kind: 'user.pending_approval', severity: 'info', title: `Pendaftaran baru menunggu persetujuan: ${user.username}`,
    message: 'Seorang pengguna baru mendaftar dan menunggu keputusan Superadmin di tab Pengguna.',
    fields: [{ name: 'Username', value: user.username }, { name: 'IP', value: getClientIp(headers) }], dedupeKey: userKey(user.username),
  }, { redis });
  return { username: user.username, role: user.role, status: user.status };
}
