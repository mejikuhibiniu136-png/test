// Mode maintenance: settings runtime, helper 503, pagar di handler ingest, dan pintu depan proxy.ts.
// Memakai Redis tiruan (hash settings saja); semua perintah Redis lain sengaja melempar error
// supaya terbukti request yang ditolak tidak menyentuh auth, rate limit, antrean, atau penyimpanan.
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAINTENANCE_RETRY_SECONDS, checkMaintenance, isIngestPath, maintenanceResponse } from '@/lib/maintenance';
import {
  DEFAULT_MAINTENANCE_MESSAGE,
  MAX_MAINTENANCE_MESSAGE,
  __resetRuntimeSettingsCache,
  cleanMaintenanceMessage,
  readRuntimeSettings,
  readSettings,
} from '@/lib/settings';
import type { RedisLike } from '@/lib/redis';

const hash: Record<string, string> = {};
let commands: string[] = [];
let hashFails = false;

const fakeRedis = new Proxy({} as RedisLike, {
  get: (_t, prop: string) => async (...args: unknown[]) => {
    commands.push(prop);
    if (prop === 'hgetall') {
      if (hashFails) throw new Error('Redis down');
      return { ...hash };
    }
    throw new Error(`perintah Redis tidak boleh dipanggil saat maintenance: ${prop} ${JSON.stringify(args)}`);
  },
});

vi.mock('@/lib/redis', () => ({ getRedis: () => fakeRedis }));

const { handleIngest, preflight } = await import('@/lib/ingest/handler');
const { proxy } = await import('@/proxy');
const { GET: statusGET } = await import('@/app/api/maintenance/route');

const setMaintenance = (on: boolean, message?: string) => {
  for (const k of Object.keys(hash)) delete hash[k];
  if (on) hash.MAINTENANCE_MODE = 'true';
  if (message !== undefined) hash.MAINTENANCE_MESSAGE = message;
};

beforeEach(() => {
  setMaintenance(false);
  commands = [];
  hashFails = false;
  __resetRuntimeSettingsCache();
});

describe('cleanMaintenanceMessage', () => {
  it('membuang karakter kontrol dan baris baru, merapikan spasi', () => {
    expect(cleanMaintenanceMessage('  Update\n\tdatabase\u0000   selesai \u2028jam 5  ')).toBe('Update database selesai jam 5');
  });
  it('membatasi panjang dan menerima nilai kosong', () => {
    expect(cleanMaintenanceMessage('x'.repeat(500))).toHaveLength(MAX_MAINTENANCE_MESSAGE);
    expect(cleanMaintenanceMessage(undefined)).toBe('');
    expect(cleanMaintenanceMessage('   ')).toBe('');
  });
});

describe('readRuntimeSettings: maintenance', () => {
  it('mati secara bawaan, teks bawaan terisi', async () => {
    const s = await readRuntimeSettings(fakeRedis);
    expect(s.maintenanceMode).toBe(false);
    expect(s.maintenanceMessage).toBe(DEFAULT_MAINTENANCE_MESSAGE);
  });
  it('menyala dengan teks kustom yang sudah dibersihkan', async () => {
    setMaintenance(true, 'Kembali jam 5\nWIB');
    const s = await readRuntimeSettings(fakeRedis);
    expect(s.maintenanceMode).toBe(true);
    expect(s.maintenanceMessage).toBe('Kembali jam 5 WIB');
  });
  it('teks kosong memakai teks bawaan; readSettings (dashboard) melaporkan kosong apa adanya', async () => {
    setMaintenance(true, '   ');
    expect((await readRuntimeSettings(fakeRedis)).maintenanceMessage).toBe(DEFAULT_MAINTENANCE_MESSAGE);
    expect((await readSettings(fakeRedis)).maintenanceMessage).toBe('');
  });
  it('Redis gagal tanpa cache: terbuka (maintenance mati); dengan cache: memakai nilai terakhir', async () => {
    hashFails = true;
    expect((await readRuntimeSettings(fakeRedis)).maintenanceMode).toBe(false);
    __resetRuntimeSettingsCache();
    hashFails = false;
    setMaintenance(true, 'Sebentar');
    await readRuntimeSettings(fakeRedis, 1_000);
    hashFails = true;
    const stale = await readRuntimeSettings(fakeRedis, 1_000 + 6_000); // cache kedaluwarsa, Redis gagal
    expect(stale).toMatchObject({ maintenanceMode: true, maintenanceMessage: 'Sebentar' });
  });
});

describe('maintenanceResponse / checkMaintenance / isIngestPath', () => {
  it('503 + maintenance:true + Retry-After + tanpa cache', async () => {
    const res = maintenanceResponse('Update');
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe(String(MAINTENANCE_RETRY_SECONDS));
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ success: false, maintenance: true, message: 'Update' });
  });
  it('checkMaintenance: null saat mati, 503 saat nyala, null (terbuka) bila Redis gagal', async () => {
    expect(await checkMaintenance(fakeRedis)).toBeNull();
    setMaintenance(true, 'Halo');
    __resetRuntimeSettingsCache();
    const res = await checkMaintenance(fakeRedis);
    expect(res?.status).toBe(503);
    __resetRuntimeSettingsCache();
    hashFails = true;
    expect(await checkMaintenance(fakeRedis)).toBeNull();
  });
  it('hanya jalur pengirim data yang dijaga', () => {
    for (const p of ['/api/webhook', '/api/receiver', '/api/receiver/universal', '/api/receiver/game', '/api/receiver/dice']) expect(isIngestPath(p)).toBe(true);
    for (const p of ['/api/auth/login', '/api/admin/settings', '/api/cron/ingest-drain', '/scripts/account_status.lua', '/api/webhooks', '/api/receivers', '/']) expect(isIngestPath(p)).toBe(false);
  });
});

describe('handleIngest saat maintenance', () => {
  const post = (headers: Record<string, string> = {}) =>
    handleIngest(new Request('http://t/api/receiver/universal', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: '{"game_name":"X"}' }), {}, { redis: fakeRedis });

  it('menolak 503 dengan teks kustom, header CORS, dan tanpa menyentuh Redis selain membaca pengaturan', async () => {
    setMaintenance(true, 'Update database');
    const res = await post();
    expect(res.status).toBe(503);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('retry-after')).toBe('60');
    expect(await res.json()).toEqual({ success: false, maintenance: true, message: 'Update database' });
    expect(commands).toEqual(['hgetall']);
  });

  it('API Key / token yang valid tidak mem-bypass maintenance', async () => {
    process.env.WEBHOOK_INGEST_TOKEN = 'rahasia';
    try {
      setMaintenance(true);
      const res = await post({ 'x-api-key': 'rahasia', authorization: 'Bearer rahasia' });
      expect(res.status).toBe(503);
      expect((await res.json()).message).toBe(DEFAULT_MAINTENANCE_MESSAGE);
      expect(commands).toEqual(['hgetall']);
    } finally {
      delete process.env.WEBHOOK_INGEST_TOKEN;
    }
  });

  it('preflight CORS tetap dijawab 204', () => {
    expect(preflight().status).toBe(204);
  });
});

describe('proxy.ts saat maintenance', () => {
  const call = (path: string, method = 'POST') => proxy(new NextRequest(`http://t${path}`, { method }));
  const passed = (res: Response) => res.headers.get('x-middleware-next') === '1';

  it('menolak 503 semua jalur pengirim data, termasuk trailing slash dan alias lama', async () => {
    setMaintenance(true, 'Sedang update');
    for (const [path, method] of [
      ['/api/receiver/universal', 'POST'],
      ['/api/receiver/universal/', 'POST'],
      ['/api/receiver/account', 'POST'],
      ['/api/receiver/game', 'POST'],
      ['/api/receiver/dice', 'POST'],
      ['/api/webhook', 'POST'],
      ['/api/receiver/universal', 'GET'],
    ] as const) {
      __resetRuntimeSettingsCache();
      const res = await call(path, method);
      expect(res.status, `${method} ${path}`).toBe(503);
      expect(await res.json()).toEqual({ success: false, maintenance: true, message: 'Sedang update' });
    }
  });

  it('jalur lain tetap lewat: preflight, skrip Lua, login, cron, dan dashboard', async () => {
    setMaintenance(true);
    expect(passed(await call('/api/receiver/universal', 'OPTIONS'))).toBe(true);
    expect(passed(await call('/scripts/account_status.lua', 'GET'))).toBe(true);
    expect(passed(await call('/api/auth/login', 'POST'))).toBe(true);
    expect(passed(await call('/api/cron/ingest-drain', 'GET'))).toBe(true);
    const admin = await call('/api/admin/settings', 'GET'); // tanpa sesi: 401 dari proxy, bukan 503
    expect(admin.status).toBe(401);
    const page = await call('/', 'GET'); // tanpa sesi: redirect ke /login, bukan 503
    expect(page.status).not.toBe(503);
  });

  it('maintenance mati: receiver dan webhook lolos seperti biasa', async () => {
    expect(passed(await call('/api/receiver/universal'))).toBe(true);
    expect(passed(await call('/api/webhook'))).toBe(true);
  });

  it('Redis gagal dibaca: pengirim data tetap lolos (terbuka)', async () => {
    hashFails = true;
    expect(passed(await call('/api/receiver/universal'))).toBe(true);
  });
});

describe('GET /api/maintenance (dipoll skrip Lua yang sedang berjalan)', () => {
  it('mati: maintenance=false dan teks kosong; tanpa cache', async () => {
    const res = await statusGET();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ success: true, maintenance: false, message: '' });
  });
  it('nyala: dijawab 200 (bukan 503) dengan teks terbaru; perubahan teks langsung terbaca', async () => {
    setMaintenance(true, 'Teks lama');
    expect(await (await statusGET()).json()).toEqual({ success: true, maintenance: true, message: 'Teks lama' });
    setMaintenance(true, 'Teks baru');
    __resetRuntimeSettingsCache(); // cache runtime 5 dtk dikosongkan seperti saat PUT pengaturan di instance yang sama
    const res = await statusGET();
    expect(res.status).toBe(200);
    expect((await res.json()).message).toBe('Teks baru');
  });
  it('nyala tanpa teks kustom: memakai teks bawaan', async () => {
    setMaintenance(true);
    expect((await (await statusGET()).json()).message).toBe(DEFAULT_MAINTENANCE_MESSAGE);
  });
  it('Redis gagal: ikut fail-open seperti penerima (maintenance=false), atau nilai cache terakhir bila ada', async () => {
    hashFails = true;
    expect(await (await statusGET()).json()).toEqual({ success: true, maintenance: false, message: '' });
    __resetRuntimeSettingsCache();
    hashFails = false;
    setMaintenance(true, 'Masih update');
    await statusGET(); // mengisi cache
    hashFails = true;
    // cache masih segar (5 dtk): tetap melaporkan maintenance walau Redis baru saja gagal
    expect(await (await statusGET()).json()).toEqual({ success: true, maintenance: true, message: 'Masih update' });
  });
  it('proxy: terbuka tanpa sesi, juga saat maintenance nyala', async () => {
    setMaintenance(true);
    const res = await proxy(new NextRequest('http://t/api/maintenance', { method: 'GET' }));
    expect(res.headers.get('x-middleware-next')).toBe('1');
  });
});
