// Menentukan sumber (game) dan jenis event dari payload, header, atau query URL.
import { cleanGameName } from '@/lib/slug';
import { cleanText } from '@/lib/accounts';
import { isPlainObject } from '@/lib/http';

// Urutan = prioritas. Kunci yang lebih spesifik untuk game didahulukan.
const GAME_KEYS = [
  'game_name', 'gameName', 'gamename', 'game_title', 'gameTitle', 'game',
  'game_id', 'gameId', 'place_name', 'placeName',
  'source', 'app_name', 'appName', 'app', 'service', 'origin', 'project',
];
const HEADER_KEYS = ['x-game-name', 'x-game', 'x-source', 'x-webhook-source'];
const QUERY_KEYS = ['game_name', 'game', 'source'];
const SEARCH_DEPTH = 2;

function valueToName(v: unknown): string | null {
  if (isPlainObject(v)) return cleanGameName(v.name) ?? cleanGameName(v.title);
  return cleanGameName(v);
}

function findKey(obj: Record<string, unknown>, depth: number): string | null {
  const lowered = new Map<string, unknown>();
  for (const [k, v] of Object.entries(obj)) lowered.set(k.toLowerCase(), v);
  for (const key of GAME_KEYS) {
    const name = valueToName(lowered.get(key.toLowerCase()));
    if (name) return name;
  }
  if (depth < SEARCH_DEPTH) {
    for (const v of Object.values(obj)) {
      if (isPlainObject(v)) {
        const found = findKey(v, depth + 1);
        if (found) return found;
      }
    }
  }
  return null;
}

// Payload bergaya Discord: `username` adalah nama pengirim webhook (mis. "Anime Dice").
const looksLikeChatWebhook = (p: Record<string, unknown>) =>
  Array.isArray(p.embeds) || typeof p.content === 'string' || typeof p.avatar_url === 'string';

export function detectGameName(
  payload: Record<string, unknown>,
  headers: Headers,
  query: URLSearchParams,
  defaultGame?: string
): string | null {
  const fromPayload = findKey(payload, 0);
  if (fromPayload) return fromPayload;
  for (const h of HEADER_KEYS) {
    const name = cleanGameName(headers.get(h));
    if (name) return name;
  }
  for (const q of QUERY_KEYS) {
    const name = cleanGameName(query.get(q));
    if (name) return name;
  }
  if (looksLikeChatWebhook(payload)) {
    const sender = cleanGameName(payload.username);
    if (sender) return sender;
  }
  return defaultGame ?? null;
}

export function detectEventType(headers: Headers, payload: Record<string, unknown>): string {
  const embeds = payload.embeds;
  const embedTitle = Array.isArray(embeds) && isPlainObject(embeds[0]) ? cleanText(embeds[0].title, 200) : undefined;
  return (
    embedTitle ??
    cleanText(headers.get('x-github-event'), 200) ??
    cleanText(headers.get('x-event-type'), 200) ??
    cleanText(payload.event, 200) ??
    cleanText(payload.eventType, 200) ??
    cleanText(payload.event_type, 200) ??
    cleanText(payload.type, 200) ??
    'Webhook'
  );
}

// Payload dari script Lua status akun menandai dirinya dengan type = "account_status".
// Webhook pihak ketiga yang kebetulan memuat field `username` TIDAK membuat akun palsu.
export function isAccountStatus(payload: Record<string, unknown>): boolean {
  const kind = String(payload.type ?? payload.kind ?? '').trim().toLowerCase();
  return kind === 'account_status' || kind === 'account-status';
}
