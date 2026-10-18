// Seluruh nama key Redis ada di sini. Dua namespace dipisahkan tegas:
//   log & webhook : logs:*, game:*, games:*, tracker:*, config:*
//   akun & user   : users:*
// Aksi "Clear Logs" hanya menyentuh key log; users:* tidak pernah disentuh oleh kode log.

export const KEYS = {
  // ----- Log & webhook -----
  streamLogs: 'logs:stream',
  streamSeq: 'logs:seq', // naik setiap ada perubahan data; dipakai SSE untuk hemat command
  gameLogs: (slug: string) => `game:${slug}:logs`,
  gamesMeta: 'games:meta', // hash: slug -> JSON metadata tabel
  gamesCounts: 'games:counts', // hash: slug -> total log diterima (seumur tabel)
  gamesAlias: 'games:alias', // hash: slug lama -> slug baru (setelah rename)
  trackerAccounts: 'tracker:accounts', // hash: username Roblox -> JSON status akun
  receiverEnabled: 'config:receiver_enabled',
  settings: 'config:settings', // hash: nama pengaturan -> nilai (sensitif dienkripsi, lihat lib/settings.ts)
  apiKeys: 'config:apikeys', // hash: sha256(API Key) -> JSON metadata; kunci aslinya TIDAK pernah disimpan
  apiKeysUsed: 'config:apikeys:used', // hash: id key -> ISO waktu terakhir dipakai
  auditLog: 'audit:log', // list, terbaru di depan, dipangkas ke AUDIT_MAX (lib/audit.ts)
  securityStats: (day: string) => `stats:security:${day}`, // hash per hari UTC: "HH:jenis" -> jumlah

  // ----- Notifikasi terpusat (Discord / Telegram) -----
  notifyConfig: 'config:notify', // hash: field "channel" -> amplop tersegel (token/URL tidak pernah plain di Redis)
  notifyLog: 'notify:log', // list hasil pengiriman terakhir (tanpa rahasia)
  notifyDedupe: (hash: string) => `notify:dedupe:${hash}`,
  notifyCounter: (scope: string, bucket: string) => `notify:cnt:${scope}:${bucket}`,

  // ----- Sesi & perangkat -----
  sessionsIndex: 'sess:index', // sorted set: username (lowercase) -> aktivitas terakhir
  sessionsOf: (usernameKey: string) => `sess:u:${usernameKey}`, // hash: sid -> JSON SessionRecord
  sessionRevoked: (sid: string) => `sess:revoked:${sid}`, // penanda cabut, TTL = sisa umur JWT

  // ----- Antrean ingest -----
  queuePending: 'q:ingest:pending', // list (LPUSH produser, RPOP konsumen = FIFO)
  queueInflight: 'q:ingest:inflight', // sorted set: item -> waktu lease habis
  queueDead: 'q:ingest:dead', // list item yang gagal berulang kali
  queueLock: 'q:ingest:lock', // kunci drainer tunggal (SET NX EX)
  queueStats: 'q:ingest:stats', // hash: enqueued, processed, failed, dead

  // ----- Akun & pengguna dashboard -----
  usersList: 'users:list', // sorted set: username (lowercase) -> waktu daftar
  userAccount: (usernameKey: string) => `users:account:${usernameKey}`,
  userDevices: (usernameKey: string) => `users:devices:${usernameKey}`,

  // ----- Pembatas laju -----
  rateLimit: (scope: string, id: string) => `rl:${scope}:${id}`,

  // ----- HWID fingerprinting & watermarking -----
  // Akun Roblox diikat ke hash HWID (fingerprint akun+game). Saat skrip diunduh, payload
  // terenkripsi (accountId, userId, hwidHash, issuedAt) disisipkan; skrip memverifikasi saat jalan.
  hwidBind: (accountId: string) => `hwid:bind:${accountId}`, // hash: { hwidHash, boundAt, boundBy }
  hwidDownload: (id: string) => `hwid:dl:${id}`, // string JSON {accountId,hwidHash,key,issuedAt} TTL'd
  hwidLeaks: 'hwid:leaks', // list kejadian kebocoran (LPUSH, terbaru di depan, dipangkas)
  hwidLeakSeq: 'hwid:leaks:seq', // penanda perubahan daftar kebocoran

  // ----- Remote kill-switch / perintah kontrol -----
  // Perintah KILL/PAUSE/RESUME per accountId dengan TTL pendek. control:cmd:<id> = perintah
  // (auto-kedaluwarsa); control:index = daftar accountId yang diberi perintah (untuk dashboard).
  controlCmd: (accountId: string) => `control:cmd:${accountId}`,
  controlIndex: 'control:index', // hash: accountId -> ISO waktu perintah diterbitkan
} as const;

// Kunci yang boleh dihapus oleh aksi Clear Logs (daftar putih, sengaja terpisah dari users:*).
export function clearableLogKeys(slugs: string[], scope: 'all' | 'stream' | { game: string }): string[] {
  if (scope === 'stream') return [KEYS.streamLogs];
  if (scope === 'all') return [KEYS.streamLogs, ...slugs.map(KEYS.gameLogs)];
  return [KEYS.gameLogs(scope.game)];
}

// ----- API Key & verifikasi signature HMAC (Superadmin: Pengaturan Sistem / Keamanan) -----
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const API_KEY_PREFIX = 'dbde_';

// Kunci acak kriptografis (32 byte, encode hex) berprefiks agar mudah dikenali di log/UI.
// Disimpan terenkripsi (lib/settings.ts writeSecretSetting); ditampilkan utuh ke Superadmin
// hanya sekali, tepat setelah di-generate.
export function generateApiKey(): string {
  return `${API_KEY_PREFIX}${randomBytes(24).toString('hex')}`;
}

export function maskApiKey(key: string): string {
  if (key.length <= 10) return '••••••••';
  return `${key.slice(0, 9)}${'•'.repeat(8)}${key.slice(-4)}`;
}

// Verifikasi API key dari request (header x-api-key) terhadap nilai yang tersimpan, waktu konstan.
export function verifyApiKey(provided: string | null | undefined, expected: string): boolean {
  if (!provided) return false;
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

// Verifikasi signature HMAC-SHA256 (header X-Webhook-Signature / X-Hub-Signature-256) terhadap
// body mentah + WEBHOOK_SECRET yang didekripsi dari Redis. Dipakai app/api/webhook & receiver/*.
export function verifyHmacSignature(rawBody: Uint8Array, signatureHeader: string | null | undefined, secret: string): boolean {
  if (!signatureHeader) return false;
  const provided = signatureHeader.replace(/^sha256=/i, '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(provided)) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  return timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(expected, 'hex'));
}
