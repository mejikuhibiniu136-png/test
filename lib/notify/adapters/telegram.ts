import { escapeHtml, truncate } from '@/lib/notify/text';
import type { AlertEvent, NotifyAdapter, Severity, TelegramTarget } from '@/lib/notify/types';

const TOKEN = /^\d{5,15}:[A-Za-z0-9_-]{30,64}$/;
const CHAT = /^(-?\d{5,20}|@[A-Za-z][A-Za-z0-9_]{4,31})$/;
const ICON: Record<Severity, string> = { info: 'ℹ️', warning: '⚠️', critical: '🚨' };

export const telegramAdapter: NotifyAdapter<TelegramTarget> = {
  platform: 'telegram',
  validate(t) {
    if (!TOKEN.test(t.botToken.trim())) return 'Bot Token Telegram tidak valid (format 123456789:AA…)';
    if (!CHAT.test(t.chatId.trim())) return 'Chat ID tidak valid (angka, mis. -1001234567890, atau @namakanal)';
    return null;
  },
  format(event: AlertEvent, t) {
    const lines = [
      `${ICON[event.severity]} <b>${escapeHtml(truncate(event.title, 200))}</b>`,
      escapeHtml(truncate(event.message, 2500)),
      ...(event.fields ?? []).slice(0, 20).map((f) => `<b>${escapeHtml(truncate(f.name, 60))}</b>: <code>${escapeHtml(truncate(f.value.replace(/[\u0000-\u001f\u007f]+/g, ' '), 300))}</code>`),
      `<i>${escapeHtml(event.kind)} · ${event.severity}</i>`,
    ];
    return {
      // Host tetap api.telegram.org: token hanya muncul di path, bukan di host.
      url: `https://api.telegram.org/bot${t.botToken.trim()}/sendMessage`,
      body: { chat_id: t.chatId.trim(), text: truncate(lines.join('\n'), 4096), parse_mode: 'HTML', disable_web_page_preview: true },
    };
  },
  retryAfterSeconds(status, headers, body) {
    if (status !== 429) return null;
    const p = body && typeof body === 'object' ? (body as { parameters?: { retry_after?: unknown } }).parameters : undefined;
    const v = Number(p?.retry_after ?? headers.get('retry-after'));
    return Number.isFinite(v) && v > 0 ? v : 1;
  },
  hint(t) {
    const bot = t.botToken.split(':')[0] ?? '';
    return `bot ${bot.slice(0, 3)}…${bot.slice(-2)}:•••• → ${t.chatId.slice(0, 4)}…${t.chatId.slice(-3)}`;
  },
  secrets: (t) => [t.botToken, t.botToken.split(':')[1] ?? ''],
};
