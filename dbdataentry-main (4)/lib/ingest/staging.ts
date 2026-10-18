// Staging sementara (Vercel /tmp) sebelum data masuk Upstash Redis.
//
// Alur: (1) body mentah ditulis ke file sementara bersama checksum dan panjang yang diklaim
// pengirim, (2) file dibaca ulang dan diverifikasi (tidak terpotong, tidak berubah),
// (3) pemanggil memproses isinya dan menyimpannya ke Redis, (4) file DIHAPUS di `finally`,
// baik berhasil maupun gagal. File yang tertinggal karena proses mati disapu otomatis.
//
// Catatan: /tmp di Vercel bersifat per-instance dan hilang sewaktu-waktu. Staging di sini
// berfungsi sebagai gerbang verifikasi integritas, bukan penyimpanan tahan lama.
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HttpError } from '@/lib/http';

export const STAGING_DIR = path.join(tmpdir(), 'dbdataentry-staging');
const STALE_AFTER_MS = 2 * 60 * 1000;
const SWEEP_EVERY_MS = 30 * 1000;

export interface StagedEnvelope {
  v: 1;
  id: string;
  receivedAt: string;
  contentType: string | null;
  declaredLength: number | null; // dari header Content-Length, jika ada
  length: number;
  sha256: string;
  body: string; // base64
}

export const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export function buildEnvelope(bytes: Uint8Array, contentType: string | null, declaredLength: number | null, nowMs = Date.now()): StagedEnvelope {
  return {
    v: 1,
    id: randomUUID(),
    receivedAt: new Date(nowMs).toISOString(),
    contentType,
    declaredLength,
    length: bytes.length,
    sha256: sha256(bytes),
    body: Buffer.from(bytes).toString('base64'),
  };
}

// Memastikan isi amplop utuh. Mengembalikan body yang sudah terverifikasi.
export function verifyEnvelope(env: StagedEnvelope): Uint8Array {
  if (!env || env.v !== 1 || typeof env.body !== 'string') throw new HttpError(422, 'Data staging rusak');
  const bytes = new Uint8Array(Buffer.from(env.body, 'base64'));
  if (env.declaredLength !== null && bytes.length !== env.declaredLength) {
    throw new HttpError(400, 'Payload terpotong: ukuran diterima tidak sama dengan Content-Length');
  }
  if (bytes.length !== env.length || sha256(bytes) !== env.sha256) {
    throw new HttpError(422, 'Payload rusak: checksum tidak cocok');
  }
  return bytes;
}

let lastSweep = 0;

// Menghapus file staging yang tertinggal (proses mati di tengah jalan). Murah: dipanggil
// paling sering sekali per 30 detik per instance.
export async function sweepStale(nowMs = Date.now(), dir = STAGING_DIR): Promise<number> {
  if (nowMs - lastSweep < SWEEP_EVERY_MS) return 0;
  lastSweep = nowMs;
  let removed = 0;
  try {
    for (const name of await readdir(/*turbopackIgnore: true*/ dir)) {
      const file = path.join(dir, name);
      try {
        const info = await stat(/*turbopackIgnore: true*/ file);
        if (nowMs - info.mtimeMs > STALE_AFTER_MS) {
          await rm(/*turbopackIgnore: true*/ file, { force: true });
          removed += 1;
        }
      } catch {
        // file sudah dihapus proses lain
      }
    }
  } catch {
    // direktori belum ada: tidak ada yang perlu disapu
  }
  return removed;
}

export const __resetSweep = () => {
  lastSweep = 0;
};

export interface StagedResult<T> {
  value: T;
  staged: boolean; // false = /tmp tidak bisa ditulis, diproses dari memori (checksum tetap diperiksa)
}

// Menjalankan `fn` dengan body terverifikasi dari staging; file staging selalu dihapus setelahnya.
export async function withStaging<T>(
  bytes: Uint8Array,
  meta: { contentType: string | null; declaredLength: number | null },
  fn: (verified: Uint8Array, envelope: StagedEnvelope) => Promise<T>,
  dir = STAGING_DIR
): Promise<StagedResult<T>> {
  await sweepStale(Date.now(), dir);
  const envelope = buildEnvelope(bytes, meta.contentType, meta.declaredLength);

  // Klaim ukuran dicek sebelum menulis apa pun: payload terpotong tidak meninggalkan file.
  if (meta.declaredLength !== null && bytes.length !== meta.declaredLength) {
    throw new HttpError(400, 'Payload terpotong: ukuran diterima tidak sama dengan Content-Length');
  }

  const finalPath = path.join(dir, `${envelope.id}.json`);
  const partPath = `${finalPath}.part`;
  let staged = false;

  try {
    try {
      await mkdir(/*turbopackIgnore: true*/ dir, { recursive: true });
      await writeFile(/*turbopackIgnore: true*/ partPath, JSON.stringify(envelope), { flag: 'wx' });
      await rename(/*turbopackIgnore: true*/ partPath, finalPath); // atomik: pembaca tidak pernah melihat file setengah jadi
      staged = true;
    } catch (err) {
      console.error('[staging] /tmp tidak dapat ditulis, memproses dari memori:', err);
    }

    let verified: Uint8Array;
    if (staged) {
      const readBack = JSON.parse(await readFile(/*turbopackIgnore: true*/ finalPath, 'utf8')) as StagedEnvelope;
      verified = verifyEnvelope(readBack);
    } else {
      verified = verifyEnvelope(envelope);
    }

    return { value: await fn(verified, envelope), staged };
  } finally {
    // Rollback: tidak ada file sementara yang tertinggal, apa pun hasilnya.
    await Promise.all([rm(/*turbopackIgnore: true*/ partPath, { force: true }), rm(/*turbopackIgnore: true*/ finalPath, { force: true })]).catch(() => undefined);
  }
}
