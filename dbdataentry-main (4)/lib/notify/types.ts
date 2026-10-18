// Kontrak notifikasi terpusat. Seluruh pemicu (login IP baru, lonjakan error, pending approval, ...)
// menghasilkan AlertEvent standar; adapter platform yang menerjemahkannya ke Discord / Telegram.
export const SEVERITIES = ['info', 'warning', 'critical'] as const;
export type Severity = (typeof SEVERITIES)[number];
export const SEVERITY_RANK: Readonly<Record<Severity, number>> = { info: 0, warning: 1, critical: 2 };

export const ALERT_KINDS = [
  'auth.new_ip', 'security.spike', 'ingest.error_spike', 'user.pending_approval',
  'queue.backlog', 'queue.dead_letter', 'crypto.rotation', 'session.revoked', 'system.test',
] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

export interface AlertField { name: string; value: string; inline?: boolean }

export interface AlertEvent {
  kind: AlertKind;
  severity: Severity;
  title: string;
  message: string;
  fields?: AlertField[];
  /** Kunci peredam duplikat: kejadian dengan kind + dedupeKey sama dikirim paling sering sekali per jendela. */
  dedupeKey?: string;
  /** Jendela peredam (detik). 0 = tanpa peredam. Bawaan per jenis lihat DEFAULT_DEDUPE_SECONDS. */
  dedupeSeconds?: number;
  at?: string;
}

export const DEFAULT_DEDUPE_SECONDS: Readonly<Record<AlertKind, number>> = {
  'auth.new_ip': 3600, 'security.spike': 900, 'ingest.error_spike': 900, 'user.pending_approval': 60,
  'queue.backlog': 900, 'queue.dead_letter': 900, 'crypto.rotation': 3600, 'session.revoked': 0, 'system.test': 0,
};

export type Platform = 'discord' | 'telegram';
export const PLATFORMS: readonly Platform[] = ['discord', 'telegram'];

export interface DiscordTarget { webhookUrl: string }
export interface TelegramTarget { botToken: string; chatId: string }

/** Konfigurasi tunggal yang disegel di Redis. Hanya satu tujuan aktif pada satu waktu. */
export interface StoredChannel {
  platform: Platform;
  enabled: boolean;
  minSeverity: Severity;
  /** 'all' atau daftar jenis yang dilanggan. */
  kinds: 'all' | AlertKind[];
  discord?: DiscordTarget;
  telegram?: TelegramTarget;
  updatedAt: string;
  updatedBy: string;
}

/** Bentuk yang aman dikirim ke browser: tidak pernah memuat URL/token utuh. */
export interface ChannelView {
  configured: boolean;
  platform: Platform | null;
  enabled: boolean;
  minSeverity: Severity;
  kinds: 'all' | AlertKind[];
  hint: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface DeliveryRecord {
  id: string;
  at: string;
  kind: AlertKind;
  severity: Severity;
  platform: Platform;
  title: string;
  ok: boolean;
  status: number | null;
  attempts: number;
  error?: string;
}

export interface HttpRequestSpec { url: string; body: unknown }

export interface NotifyAdapter<T> {
  platform: Platform;
  /** Memvalidasi target (anti-SSRF: host dipatok). Mengembalikan pesan galat atau null bila valid. */
  validate(target: T): string | null;
  format(event: AlertEvent, target: T): HttpRequestSpec;
  /** Detik tunggu yang diminta platform pada respons 429, bila ada. */
  retryAfterSeconds(status: number, headers: Headers, body: unknown): number | null;
  /** Petunjuk aman untuk UI. */
  hint(target: T): string;
  /** Teks rahasia yang harus disamarkan dari pesan galat. */
  secrets(target: T): string[];
}
