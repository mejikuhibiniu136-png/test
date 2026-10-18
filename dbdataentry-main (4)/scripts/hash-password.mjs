// Membuat hash Argon2id untuk ADMIN_PASSWORD_HASH.
// Pemakaian:  npm run hash -- "password-anda"
import { hash } from '@node-rs/argon2';

const password = process.argv[2];
if (!password) {
  console.error('Pemakaian: npm run hash -- "password-anda"');
  process.exit(1);
}

// Argon2id (bawaan library), parameter OWASP: m=19 MiB, t=2, p=1.
const hashed = await hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
console.log('\nSalin nilai berikut ke env ADMIN_PASSWORD_HASH:\n');
console.log(hashed);
console.log('\nCatatan: di file .env / .env.local, escape setiap karakter $ menjadi \\$');
console.log('(di dashboard Vercel tidak perlu di-escape).\n');
