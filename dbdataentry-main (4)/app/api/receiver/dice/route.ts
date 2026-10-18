import { handleIngest, preflight } from '@/lib/ingest/handler';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Alias lama webhook Anime Dice (parameter ?key=... diabaikan kecuali WEBHOOK_INGEST_TOKEN diset).
export const POST = (request: Request) => handleIngest(request, { defaultGame: 'Anime Dice' });
export const OPTIONS = () => preflight();
