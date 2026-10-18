// Matriks RBAC berjenjang:
//   superadmin : akses mutlak (satu-satunya akun dari .env Vercel, permanen, tidak bisa diubah)
//   admin      : CRUD akun & game, lihat pengguna/log, TIDAK bisa approve/reject/kelola sistem
//   viewer     : baca saja (default untuk pendaftar baru, sampai disetujui superadmin)
export type Role = 'superadmin' | 'admin' | 'viewer';
// Role yang disimpan di Redis untuk users:account:* (superadmin selalu dari env, tidak pernah disimpan)
export type StorableRole = 'admin' | 'viewer';

// pending   : baru daftar, menunggu keputusan superadmin
// active    : disetujui, boleh memakai dashboard sesuai role
// suspended : ditangguhkan superadmin (bisa diaktifkan lagi)
// rejected  : ditolak superadmin
export type UserStatus = 'pending' | 'active' | 'suspended' | 'rejected';

export interface SessionClaims {
  sub: string; // username
  role: Role;
  status: UserStatus; // superadmin selalu 'active'; proxy mengarahkan status lain ke /pending-approval
  sid: string; // id sesi, juga dicatat di riwayat perangkat
  iat?: number;
  exp?: number;
}

// Payload webhook bebas bentuk; UI membacanya lewat helper bertipe aman.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Payload = Record<string, any>;

export type IngestFormat = 'json' | 'urlencoded' | 'form-data' | 'text' | 'empty';

export interface LogEntry {
  id: string;
  game: string; // slug tabel
  gameName: string;
  eventType: string;
  payload: Payload;
  format: IngestFormat;
  bytes: number;
  processingTimeMs: number;
  receivedAt: string;
}

export interface GameTable {
  slug: string;
  name: string;
  builtin: boolean;
  source: 'builtin' | 'auto' | 'manual';
  createdAt: string;
  createdBy?: string;
  total: number; // jumlah log diterima sejak tabel dibuat
}

export interface TrackedAccount {
  username: string;
  displayName: string;
  userId: string;
  placeId: string;
  jobId: string;
  gameName: string;
  event: string;
  state: 'ONLINE' | 'OFFLINE';
  status: 'ONLINE' | 'OFFLINE';
  avatarUrl: string;
  timestamp: string;
  sessionStart: string;
  lastUpdate: string;
  latencyMs: number;
  fps?: number; // telemetri klien Roblox (opsional)
  pingMs?: number;
  memoryMb?: number;
  rev: number;
}

export interface DeviceEntry {
  sid: string;
  at: string;
  ip: string;
  device: string; // Windows / Android / iOS / macOS / ...
  deviceType: 'desktop' | 'mobile' | 'tablet' | 'bot' | 'unknown';
  os: string;
  browser: string;
  city: string | null;
  region: string | null;
  country: string | null;
  isp: string | null;
  userAgent: string;
}

export interface UserSummary {
  username: string;
  role: Role;
  status: UserStatus;
  createdAt: string | null;
  lastLogin: DeviceEntry | null;
  /** true untuk akun superadmin (dari .env): tidak bisa diubah/ditangguhkan/dihapus dari dashboard. */
  immutable: boolean;
}

// Pengaturan dinamis (Upstash Redis, hanya dibaca/ditulis Superadmin). Nilai sensitif
// (WEBHOOK_SECRET, API_KEY) dienkripsi AES-256-GCM di Redis; endpoint hanya melaporkan "sudah diisi".
export interface SystemSettings {
  maintenanceMode: boolean;
  /** Teks maintenance kustom yang tampil di panel skrip Lua (kosong = teks bawaan server). */
  maintenanceMessage: string;
  rateLimitPerMin: number;
  luaObfuscationEnabled: boolean;
  webhookSecretSet: boolean;
  /** true = receiver menolak request tanpa API Key dashboard yang valid (default mati: endpoint terbuka). */
  apiKeyRequired: boolean;
  /** Log lebih tua dari N hari dihapus (0 = nonaktif). */
  logRetentionDays: number;
  /** true = ingest masuk antrean Redis (202) dan diproses asinkron; false = tulis langsung (bawaan). */
  ingestQueueEnabled: boolean;
}

// Status enkripsi untuk panel rotasi kunci (tanpa nilai rahasia).
export interface EncryptionStatus {
  /** ENCRYPTION_KEY_PREVIOUS: kosong / valid / diisi tetapi bukan hex 64 karakter. */
  previousKey: 'unset' | 'valid' | 'invalid';
  /** Secret yang masih terenkripsi dengan kunci lama (perlu "Enkripsi ulang"). */
  stale: number;
  /** Secret yang tidak bisa dibuka oleh kunci mana pun. */
  undecryptable: number;
}

export interface ApiKeyView {
  id: string;
  label: string;
  /** Penanda aman, mis. dbde_2bb5••••••••7853. */
  hint: string;
  createdAt: string;
  createdBy: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  expired: boolean;
}

export type AuditAction =
  | 'settings.update'
  | 'apikey.create'
  | 'apikey.revoke'
  | 'receiver.toggle'
  | 'user.update'
  | 'logs.clear'
  | 'game.delete'
  | 'game.rename'
  | 'account.delete'
  | 'encryption.rotate'
  | 'retention.purge'
  | 'notify.update'
  | 'notify.test'
  | 'session.revoke'
  | 'queue.drain'
  | 'queue.setting'
  | 'crypto.sweep';

export interface AuditEntry {
  id: string;
  at: string;
  actor: string;
  role: string;
  action: AuditAction;
  target?: string;
  detail?: string;
  ip?: string;
}

// Kejadian keamanan receiver dalam 24 jam terakhir.
export interface SecurityStats {
  windowHours: number;
  hmacFail: number;
  authFail: number;
  rateLimited: number;
}

export interface StreamPayload {
  logs: LogEntry[];
  accounts: TrackedAccount[];
  games: GameTable[];
  game: string; // slug yang sedang dilihat ('all' = stream gabungan)
  seq: number;
  timestamp: number;
}
