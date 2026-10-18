// GET /scripts/account_status.lua: toggle Proteksi Skrip Lua harus langsung berlaku (tanpa cache).
import { beforeEach, describe, expect, it, vi } from 'vitest';

let stored: unknown = null;
let failRead = false;
const fakeRedis = {
  hget: async (_k: string, field: string) => {
    if (failRead) throw new Error('Redis down');
    return field === 'LUA_OBFUSCATION_ENABLED' ? stored : null;
  },
};
vi.mock('@/lib/redis', () => ({ getRedis: () => fakeRedis }));

const { GET } = await import('@/app/scripts/account_status.lua/route');
const fetchScript = () => GET(new Request('https://dash.example/scripts/account_status.lua', { headers: { host: 'dash.example' } }));

beforeEach(() => {
  stored = null;
  failRead = false;
});

describe('/scripts/account_status.lua', () => {
  it('toggle mati: source asli, dan header melarang cache di CDN/browser', async () => {
    stored = 'false';
    const res = await fetchScript();
    const body = await res.text();
    expect(body).toContain('KONFIGURASI');
    expect(body).toContain('https://dash.example/api/receiver/universal');
    expect(res.headers.get('x-script-protection')).toBe('off');
    expect(res.headers.get('cache-control')).toBe('no-store, max-age=0');
    expect(res.headers.get('cdn-cache-control')).toBe('no-store');
    expect(res.headers.get('vercel-cdn-cache-control')).toBe('no-store');
  });

  it.each([['string "true"', 'true'], ['boolean true (deserialisasi Upstash)', true], ['number 1', 1], ['string "1"', '1']])('toggle nyala (%s): versi ter-obfuscate', async (_label, value) => {
    stored = value;
    const res = await fetchScript();
    const body = await res.text();
    expect(res.headers.get('x-script-protection')).toBe('on');
    expect(body).toContain('ter-enkripsi penuh');
    expect(body).not.toContain('KONFIGURASI');
    expect(body).not.toContain('dash.example');
  });

  it('perubahan toggle langsung terlihat di request berikutnya, tidak ada cache di sisi server', async () => {
    stored = 'true';
    expect((await fetchScript()).headers.get('x-script-protection')).toBe('on');
    stored = 'false';
    expect((await fetchScript()).headers.get('x-script-protection')).toBe('off');
    stored = 'true';
    expect((await fetchScript()).headers.get('x-script-protection')).toBe('on');
  });

  it('kunci acak berbeda di tiap request saat proteksi nyala', async () => {
    stored = 'true';
    const [a, b] = [await (await fetchScript()).text(), await (await fetchScript()).text()];
    expect(a).not.toBe(b);
  });

  it('Redis gagal: fail open ke skrip polos', async () => {
    failRead = true;
    const res = await fetchScript();
    expect(res.headers.get('x-script-protection')).toBe('off');
    expect(await res.text()).toContain('KONFIGURASI');
  });
});
