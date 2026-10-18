// Membaca payload dari sumber apa pun: JSON, URL-encoded, multipart form-data, atau teks mentah.
// Prinsip: data tidak pernah dibuang karena bentuknya tidak dikenal. Yang tidak bisa diurai
// disimpan sebagai { text: "<isi mentah>" }.
import { isPlainObject } from '@/lib/http';
import { sanitizeDeep } from '@/lib/sanitize';
import type { IngestFormat } from '@/types';

export interface ParsedPayload {
  format: IngestFormat;
  data: Record<string, unknown>;
  contentType: string;
}

// Field form yang biasanya membungkus JSON (mis. "payload_json" milik webhook bergaya Discord).
const JSON_WRAPPER_KEYS = ['payload_json', 'payload', 'json', 'data', 'body'];
const URLENCODED_LIKE = /^[^=\s&]+=[^&]*(&[^=\s&]+=[^&]*)*$/;

const mediaType = (header: string | null) => (header ?? '').split(';')[0].trim().toLowerCase();

function tryJson(text: string): unknown | undefined {
  const t = text.trim();
  if (!t || (t[0] !== '{' && t[0] !== '[')) return undefined;
  try {
    return JSON.parse(t);
  } catch {
    return undefined;
  }
}

function fromJsonValue(value: unknown): Record<string, unknown> {
  return isPlainObject(value) ? value : { data: value };
}

// Mengangkat JSON yang terbungkus di dalam satu field form ke level atas.
function liftWrappedJson(fields: Record<string, unknown>): Record<string, unknown> {
  for (const key of JSON_WRAPPER_KEYS) {
    const value = fields[key];
    if (typeof value !== 'string') continue;
    const parsed = tryJson(value);
    if (isPlainObject(parsed)) {
      const rest = { ...fields };
      delete rest[key];
      return { ...parsed, ...rest };
    }
  }
  return fields;
}

function addField(target: Record<string, unknown>, key: string, value: unknown) {
  if (key in target) {
    const cur = target[key];
    target[key] = Array.isArray(cur) ? [...cur, value] : [cur, value];
  } else {
    target[key] = value;
  }
}

function fromUrlEncoded(text: string): Record<string, unknown> {
  const out: Record<string, unknown> = Object.create(null);
  for (const [k, v] of new URLSearchParams(text)) addField(out, k, v);
  return liftWrappedJson(out);
}

async function fromMultipart(bytes: Uint8Array, contentType: string): Promise<Record<string, unknown>> {
  const form = await new Response(bytes as BodyInit, { headers: { 'content-type': contentType } }).formData();
  const out: Record<string, unknown> = Object.create(null);
  for (const [k, v] of form.entries()) {
    // Isi file tidak disimpan, hanya metadatanya.
    if (typeof v === 'string') addField(out, k, v);
    else addField(out, k, { filename: v.name, size: v.size, type: v.type });
  }
  return liftWrappedJson(out);
}

export async function parsePayload(bytes: Uint8Array, contentTypeHeader: string | null): Promise<ParsedPayload> {
  const ct = mediaType(contentTypeHeader);
  const finish = (format: IngestFormat, data: Record<string, unknown>): ParsedPayload => ({
    format,
    data: sanitizeDeep(data),
    contentType: ct || 'unknown',
  });

  if (bytes.length === 0) return finish('empty', {});
  const text = new TextDecoder('utf-8').decode(bytes);

  if (ct === 'multipart/form-data') {
    try {
      return finish('form-data', await fromMultipart(bytes, contentTypeHeader as string));
    } catch {
      return finish('text', { text }); // multipart rusak: simpan mentah
    }
  }

  if (ct === 'application/x-www-form-urlencoded') {
    return finish('urlencoded', fromUrlEncoded(text));
  }

  // JSON: dicoba untuk content-type JSON, dan juga untuk content-type lain/kosong
  // karena banyak pengirim salah memberi label.
  const json = tryJson(text);
  if (json !== undefined) return finish('json', fromJsonValue(json));

  if ((ct === '' || ct === 'text/plain') && URLENCODED_LIKE.test(text.trim())) {
    return finish('urlencoded', fromUrlEncoded(text.trim()));
  }

  return finish('text', { text });
}
