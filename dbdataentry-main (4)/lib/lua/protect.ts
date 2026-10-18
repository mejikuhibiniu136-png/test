// Membungkus skrip Lua menjadi stub yang membuka dirinya sendiri: badan skrip terenkripsi (keystream
// xorshift32, kunci + nonce acak PER REQUEST ditanam di stub), jadi file yang tampil di browser/curl
// hanya deretan hex. Eksekutor tetap menjalankannya dengan satu baris loadstring(game:HttpGet(...))().
// Batas jujur: kunci ada di stub, jadi ini menghalangi dibaca/disalin sekilas, bukan pembongkaran niat.
import { randomBytes } from 'node:crypto';
import { sealScript } from '@/lib/lua/scriptCrypto';

const CHUNK = 4096; // genap: pasangan hex tidak terpotong antar potongan

export function buildSelfDecryptingLua(plain: string): string {
  const key = randomBytes(12).toString('hex');
  const { nonce, hex } = sealScript(plain, key);
  const chunks = hex.match(new RegExp(`.{1,${CHUNK}}`, 'g')) ?? [];
  return [
    `local K,N="${key}","${nonce}"`,
    `local D={${chunks.map((c) => `"${c}"`).join(',\n')}}`,
    'local M=4294967296',
    'local x=5381',
    'local s=K..N',
    'for i=1,#s do x=(x*33+s:byte(i))%M end',
    'if x==0 then x=0x9E3779B9 end',
    'local bx,ls,rs,ba=bit32.bxor,bit32.lshift,bit32.rshift,bit32.band',
    'local o,n={},0',
    'for _,c in ipairs(D) do',
    ' for p in c:gmatch("%x%x") do',
    '  x=bx(x,ls(x,13)) x=bx(x,rs(x,17)) x=bx(x,ls(x,5))',
    '  n=n+1 o[n]=string.char(bx(tonumber(p,16),ba(rs(x,8),255)))',
    ' end',
    'end',
    'local src=table.concat(o)',
    'if src:sub(1,10)~="--dbde-ok\\n" then return end',
    'return loadstring(src)()',
  ].join('\n');
}

// Navigasi browser (ketik URL / klik link) selalu membawa Sec-Fetch-Mode: navigate atau Accept: text/html.
// Eksekutor (HttpGet) tidak mengirim keduanya.
export function isBrowserNavigation(headers: Headers): boolean {
  return (
    headers.get('sec-fetch-mode') === 'navigate' ||
    headers.get('sec-fetch-dest') === 'document' ||
    (headers.get('accept') ?? '').includes('text/html')
  );
}
