import { mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HttpError } from '@/lib/http';
import { __resetSweep, buildEnvelope, sweepStale, verifyEnvelope, withStaging } from '@/lib/ingest/staging';
import { signSession, verifySession } from '@/lib/auth/jwt';
import { detectHashKind, hashPassword, verifyPassword } from '@/lib/auth/password';
import bcrypt from 'bcryptjs';

const bytes = (s: string) => new TextEncoder().encode(s);

describe('staging', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'stg-test-'));
    __resetSweep();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  const files = () => readdir(dir);

  it('berhasil: fn menerima body terverifikasi dan file staging dihapus', async () => {
    let seenDuring: string[] = [];
    const { value, staged } = await withStaging(bytes('{"a":1}'), { contentType: 'application/json', declaredLength: 7 }, async (b) => {
      seenDuring = await files();
      return new TextDecoder().decode(b);
    }, dir);
    expect(value).toBe('{"a":1}');
    expect(staged).toBe(true);
    expect(seenDuring).toHaveLength(1); // file memang ada selama pemrosesan
    expect(await files()).toEqual([]); // dan hilang sesudahnya
  });

  it('gagal di tengah pemrosesan: rollback, tidak ada file sampah', async () => {
    await expect(
      withStaging(bytes('xyz'), { contentType: null, declaredLength: null }, async () => {
        throw new Error('Redis down');
      }, dir)
    ).rejects.toThrow('Redis down');
    expect(await files()).toEqual([]);
  });

  it('payload terpotong (Content-Length tidak cocok): ditolak 400 dan tidak menulis apa pun', async () => {
    const err = await withStaging(bytes('{"a":'), { contentType: 'application/json', declaredLength: 20 }, async () => 'x', dir).catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(400);
    expect(await files()).toEqual([]);
  });

  it('amplop rusak terdeteksi lewat checksum dan panjang', () => {
    const env = buildEnvelope(bytes('hello world'), null, null);
    expect(new TextDecoder().decode(verifyEnvelope(env))).toBe('hello world');
    const tampered = { ...env, body: Buffer.from('hellp world').toString('base64') };
    expect(() => verifyEnvelope(tampered)).toThrow(/checksum/);
    const shortened = { ...env, body: Buffer.from('hello').toString('base64') };
    expect(() => verifyEnvelope(shortened)).toThrow();
    expect(() => verifyEnvelope({ ...env, declaredLength: 99 })).toThrow(/terpotong/);
  });

  it('direktori tidak bisa ditulis: tetap diproses dari memori, tanpa file tertinggal', async () => {
    const blocker = path.join(dir, 'file-bukan-direktori');
    await writeFile(blocker, 'x');
    const { value, staged } = await withStaging(bytes('ok'), { contentType: null, declaredLength: 2 }, async (b) => b.length, path.join(blocker, 'sub'));
    expect(value).toBe(2);
    expect(staged).toBe(false);
  });

  it('sweepStale menghapus file lama peninggalan proses yang mati, file baru dibiarkan', async () => {
    const old = path.join(dir, 'old.json');
    const fresh = path.join(dir, 'fresh.json');
    await writeFile(old, '{}');
    await writeFile(fresh, '{}');
    const past = new Date(Date.now() - 10 * 60 * 1000);
    await utimes(old, past, past);
    expect(await sweepStale(Date.now(), dir)).toBe(1);
    expect(await files()).toEqual(['fresh.json']);
  });
});

describe('jwt', () => {
  const secret = 'x'.repeat(40);
  it('sign + verify', async () => {
    const t = await signSession({ sub: 'alice', role: 'viewer', status: 'active', sid: 's1' }, secret);
    expect(await verifySession(t, secret)).toMatchObject({ sub: 'alice', role: 'viewer', status: 'active', sid: 's1' });
  });
  it('menolak secret salah, token diubah, kedaluwarsa, dan alg none', async () => {
    const now = Date.now();
    const t = await signSession({ sub: 'alice', role: 'admin', status: 'active', sid: 's' }, secret, now);
    expect(await verifySession(t, 'y'.repeat(40), now)).toBeNull();
    const [h, p, s] = t.split('.');
    const forgedPayload = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url').toString()), role: 'admin', sub: 'mallory' })).toString('base64url');
    expect(await verifySession(`${h}.${forgedPayload}.${s}`, secret, now)).toBeNull();
    expect(await verifySession(t, secret, now + 9 * 3600 * 1000)).toBeNull();
    const none = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${p}.`;
    expect(await verifySession(none, secret, now)).toBeNull();
    expect(await verifySession('', secret)).toBeNull();
  });
});

describe('password', () => {
  it('Argon2id: hash berformat benar, verifikasi benar/salah', async () => {
    const h = await hashPassword('rahasia-123');
    expect(h.startsWith('$argon2id$')).toBe(true);
    expect(detectHashKind(h)).toBe('argon2id');
    expect(await verifyPassword(h, 'rahasia-123')).toBe(true);
    expect(await verifyPassword(h, 'salah')).toBe(false);
    expect(await hashPassword('rahasia-123')).not.toBe(h); // salt acak
  });
  it('hash bcrypt lama tetap diterima; format asing ditolak', async () => {
    const b = bcrypt.hashSync('lama-456', 10);
    expect(detectHashKind(b)).toBe('bcrypt');
    expect(await verifyPassword(b, 'lama-456')).toBe(true);
    expect(await verifyPassword(b, 'x')).toBe(false);
    expect(await verifyPassword('plaintext', 'plaintext')).toBe(false);
    expect(await verifyPassword('', '')).toBe(false);
  });
});
