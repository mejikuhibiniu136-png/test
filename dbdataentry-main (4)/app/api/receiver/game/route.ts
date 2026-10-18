import { handleIngest, preflight } from '@/lib/ingest/handler';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Alias lama untuk script Lua yang sudah terpasang: dianggap status akun.
// Script baru memakai /api/receiver/universal. Folder ini aman dihapus bila tidak ada script lama.
export const POST = (request: Request) => handleIngest(request, { forceAccount: true });
export const OPTIONS = () => preflight();
