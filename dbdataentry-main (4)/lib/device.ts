// Identitas perangkat, browser, IP, dan lokasi pengguna saat login.
import { getClientIp } from '@/lib/http';
import type { DeviceEntry } from '@/types';

export interface ParsedUserAgent {
  os: string;
  browser: string;
  deviceType: DeviceEntry['deviceType'];
}

// Urutan pemeriksaan penting: Edge/Opera/Samsung membawa token "Chrome", Chrome iOS memakai "CriOS".
export function parseUserAgent(ua: string | null | undefined): ParsedUserAgent {
  const s = (ua ?? '').slice(0, 512);
  if (!s) return { os: 'Unknown', browser: 'Unknown', deviceType: 'unknown' };

  let os = 'Unknown';
  if (/windows nt|windows phone/i.test(s)) os = 'Windows';
  else if (/android/i.test(s)) os = 'Android';
  else if (/iphone|ipad|ipod/i.test(s)) os = 'iOS';
  else if (/cros/i.test(s)) os = 'ChromeOS';
  else if (/mac os x|macintosh/i.test(s)) os = 'macOS';
  else if (/linux|x11/i.test(s)) os = 'Linux';

  let browser = 'Unknown';
  if (/edg(e|a|ios)?\//i.test(s)) browser = 'Edge';
  else if (/opr\/|opera/i.test(s)) browser = 'Opera';
  else if (/samsungbrowser/i.test(s)) browser = 'Samsung Internet';
  else if (/firefox|fxios/i.test(s)) browser = 'Firefox';
  else if (/chrome|crios|chromium/i.test(s)) browser = 'Chrome';
  else if (/safari/i.test(s) && /version\//i.test(s)) browser = 'Safari';
  else if (/curl\//i.test(s)) browser = 'curl';

  let deviceType: ParsedUserAgent['deviceType'] = 'desktop';
  if (/bot|crawler|spider|curl\/|wget|python-requests|httpclient/i.test(s)) deviceType = 'bot';
  else if (/ipad|tablet|(android(?!.*mobile))/i.test(s)) deviceType = 'tablet';
  else if (/mobi|iphone|ipod|android/i.test(s)) deviceType = 'mobile';
  else if (os === 'Unknown') deviceType = 'unknown';

  return { os, browser, deviceType };
}

export interface GeoInfo {
  city: string | null;
  region: string | null;
  country: string | null;
}

const decodeHeader = (v: string | null): string | null => {
  if (!v) return null;
  try {
    return decodeURIComponent(v).slice(0, 96) || null; // x-vercel-ip-city dikirim ter-encode
  } catch {
    return v.slice(0, 96);
  }
};

// Geolokasi bawaan Vercel (header x-vercel-ip-*). Kosong saat dijalankan lokal.
export function readGeo(headers: Headers): GeoInfo {
  return {
    city: decodeHeader(headers.get('x-vercel-ip-city')),
    region: decodeHeader(headers.get('x-vercel-ip-country-region')),
    country: decodeHeader(headers.get('x-vercel-ip-country')),
  };
}

const PRIVATE_IP = /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fc|fd|unknown$)/i;

// Vercel tidak menyediakan nama ISP di header-nya, jadi ISP dicari lewat layanan eksternal
// (best effort, timeout pendek, boleh gagal). Matikan dengan GEOIP_ISP_LOOKUP=off.
export async function lookupIsp(ip: string, env: Record<string, string | undefined> = process.env): Promise<string | null> {
  if ((env.GEOIP_ISP_LOOKUP ?? '').trim().toLowerCase() === 'off') return null;
  if (!ip || PRIVATE_IP.test(ip)) return null;
  try {
    const res = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}?fields=success,connection`, {
      signal: AbortSignal.timeout(1500),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { success?: boolean; connection?: { isp?: string; org?: string } };
    if (data.success === false) return null;
    const name = data.connection?.isp || data.connection?.org;
    return typeof name === 'string' && name ? name.slice(0, 96) : null;
  } catch {
    return null;
  }
}

export async function buildDeviceEntry(headers: Headers, sid: string, nowMs = Date.now()): Promise<DeviceEntry> {
  const userAgent = (headers.get('user-agent') ?? '').slice(0, 512);
  const ip = getClientIp(headers);
  const parsed = parseUserAgent(userAgent);
  const geo = readGeo(headers);
  const isp = await lookupIsp(ip);
  return {
    sid,
    at: new Date(nowMs).toISOString(),
    ip,
    device: parsed.os,
    deviceType: parsed.deviceType,
    os: parsed.os,
    browser: parsed.browser,
    ...geo,
    isp,
    userAgent,
  };
}
