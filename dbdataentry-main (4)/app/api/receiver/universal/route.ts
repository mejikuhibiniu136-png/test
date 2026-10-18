import { handleIngest, ingestInfo, preflight } from '@/lib/ingest/handler';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs'; // staging memakai filesystem (/tmp)
export const maxDuration = 30;

// Endpoint tunggal untuk semua sumber webhook: JSON, URL-encoded, form-data, atau teks mentah.
export const POST = (request: Request) => handleIngest(request);
export const GET = () => ingestInfo();
export const OPTIONS = () => preflight();
