import { cookies } from 'next/headers';
import bcrypt from 'bcryptjs';

export async function POST(request) {
  try {
    const { username, password } = await request.json();

    const envUser = process.env.DASHBOARD_USER || 'admin';
    // DASHBOARD_PASS_HASH berisi nilai hash bcrypt dari Vercel
    const envPassHash = process.env.DASHBOARD_PASS_HASH || '$2y$19$QW4Ps7XD.qiLEa4G9DghlOhv76BEd9AqlWW91yJauiQVwIIXnPGli';

    // 1. Cek Username
    const isUserValid = username === envUser;

    // 2. Verifikasi Password dengan Hash
    const isPasswordValid = await bcrypt.compare(password, envPassHash);

    if (isUserValid && isPasswordValid) {
      // Simpan cookie auth selama 1 jam (3600 detik)
      cookies().set('auth_token', 'logged_in_session', {
        httpOnly: true,
        secure: true,
        maxAge: 60 * 60,
        path: '/',
      });

      return Response.json({ success: true }, { status: 200 });
    }

    return Response.json({ success: false, message: 'Username atau Password salah!' }, { status: 401 });
  } catch (err) {
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
}
