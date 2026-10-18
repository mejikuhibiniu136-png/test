import { truncate, inlineCode } from '@/lib/notify/text';
import type { AlertEvent, DiscordTarget, NotifyAdapter, Severity } from '@/lib/notify/types';

// Host dipatok ke domain Discord: Superadmin (atau penyerang yang membajak sesinya) tidak bisa
// mengarahkan server ke alamat internal / sembarang (SSRF).
const HOSTS = new Set(['discord.com', 'discordapp.com', 'ptb.discord.com', 'canary.discord.com']);
const PATH = /^\/api\/webhooks\/\d{15,25}\/[A-Za-z0-9._-]{20,120}$/;
const COLOR: Record<Severity, number> = { info: 0x38bdf8, warning: 0xfbbf24, critical: 0xf43f5e };

export function parseDiscordUrl(raw: string): URL | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'https:' || u.username || u.password || u.port || !HOSTS.has(u.hostname) || !PATH.test(u.pathname)) return null;
    return u;
  } catch {
    return null;
  }
}

export const discordAdapter: NotifyAdapter<DiscordTarget> = {
  platform: 'discord',
  validate: (t) => (parseDiscordUrl(t.webhookUrl) ? null : 'URL webhook Discord tidak valid (harus https://discord.com/api/webhooks/<id>/<token>)'),
  format(event: AlertEvent, t) {
    const url = parseDiscordUrl(t.webhookUrl);
    if (!url) throw new Error('URL webhook Discord tidak valid');
    return {
      url: `${url.origin}${url.pathname}?wait=false`,
      body: {
        username: 'dbdataentry',
        // Isi dari pengguna tidak boleh memicu @everyone / @role / @user.
        allowed_mentions: { parse: [] },
        embeds: [{
          title: truncate(event.title, 256),
          description: truncate(event.message, 4000),
          color: COLOR[event.severity],
          timestamp: event.at ?? new Date().toISOString(),
          footer: { text: `${event.kind} · ${event.severity}` },
          fields: (event.fields ?? []).slice(0, 25).map((f) => ({ name: truncate(f.name, 256) || '-', value: inlineCode(f.value, 1000), inline: f.inline ?? true })),
        }],
      },
    };
  },
  retryAfterSeconds(status, headers, body) {
    if (status !== 429) return null;
    const fromBody = body && typeof body === 'object' ? Number((body as { retry_after?: unknown }).retry_after) : NaN;
    const fromHeader = Number(headers.get('retry-after'));
    const v = Number.isFinite(fromBody) && fromBody > 0 ? fromBody : Number.isFinite(fromHeader) && fromHeader > 0 ? fromHeader : 1;
    return v;
  },
  hint(t) {
    const u = parseDiscordUrl(t.webhookUrl);
    const id = u?.pathname.split('/')[3] ?? '';
    return u ? `discord.com/api/webhooks/${id.slice(0, 4)}…${id.slice(-3)}/••••` : '••••';
  },
  secrets: (t) => [t.webhookUrl, t.webhookUrl.split('/').pop() ?? ''],
};
