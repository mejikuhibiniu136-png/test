import { discordAdapter } from '@/lib/notify/adapters/discord';
import { telegramAdapter } from '@/lib/notify/adapters/telegram';
import type { DiscordTarget, NotifyAdapter, Platform, StoredChannel, TelegramTarget } from '@/lib/notify/types';

// Titik perluasan: platform baru (Slack, Teams, ...) cukup menambah adapter dan mendaftarkannya di sini.
export interface Resolved<T = unknown> { adapter: NotifyAdapter<T>; target: T }

export function resolveAdapter(channel: StoredChannel): Resolved | null {
  const byPlatform: Record<Platform, () => Resolved | null> = {
    discord: () => (channel.discord ? { adapter: discordAdapter as NotifyAdapter<unknown>, target: channel.discord satisfies DiscordTarget } : null),
    telegram: () => (channel.telegram ? { adapter: telegramAdapter as NotifyAdapter<unknown>, target: channel.telegram satisfies TelegramTarget } : null),
  };
  return byPlatform[channel.platform]?.() ?? null;
}

export { discordAdapter, telegramAdapter };
