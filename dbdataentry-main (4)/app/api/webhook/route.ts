import { handleIngest, preflight } from '@/lib/ingest/handler';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Alias lama /api/webhook (webhook Anime Dice versi sebelumnya).
export const POST = (request: Request) => handleIngest(request, { defaultGame: 'Anime Dice' });
export const OPTIONS = () => preflight();
