// Proteksi skrip Lua sisi server (fitur 1 — tidak bergantung pada layanan eksternal
// berbayar/berkunci seperti WeAreDevs API atau Lua Obfuscator SaaS, karena kredensial
// mereka tidak tersedia di deployment ini). Skema yang dipakai di sini berjalan sepenuhnya
// di server kita sendiri sehingga aktif tanpa konfigurasi tambahan, dan setiap request
// menghasilkan output BERBEDA (kunci XOR acak + nama variabel acak per panggilan):
//
//   1) Enkripsi string (XOR byte-stream, direpresentasikan sebagai escape HEX Lua
//      `"\xNN\xNN..."`) untuk variabel sensitif (alamat endpoint webhook).
//   2) Penyamaran nama variabel lokal: setiap `local <nama> = ...` / `local function <nama>`
//      diganti nama acak pendek. Diimplementasikan dengan scanner token (bukan regex polos)
//      supaya akses field (`obj.nama`), key tabel (`{ nama = ... }`), dan literal string tidak
//      pernah ikut berubah — regex polos akan merusak itu.
//   3) Kontrol aliran (control-flow obfuscation): seluruh skrip dibungkus percabangan
//      if/else yang nilainya terbukti selalu benar saat jalan, tapi tidak trivial dibaca
//      analisis statis, plus cabang "mati" berisi kode semu.
//   4) Wrapper loadstring/pcall: SELURUH hasil langkah 1-3 dienkripsi XOR+HEX sekali lagi dan
//      dibungkus bootstrap kecil yang men-decode lalu `loadstring(...)` + `pcall(...)`-nya saat
//      runtime. Yang tersaji ke `GET /scripts/account_status.lua` jadinya cuma bootstrap loader
//      + satu string hex panjang — bukan source Lua yang bisa langsung dibaca orang.
//
// Tidak ada API key / secret tambahan yang dibutuhkan: semua kunci XOR dibangkitkan acak di
// memori per-request oleh server kita sendiri, lalu disisipkan sebagai decoder di skrip yang
// sama. Eksekusi oleh executor (loadstring(game:HttpGet(...))()) tetap otomatis seperti biasa.
//
// Trade-off: wrapper langkah 4 membesarkan ukuran respons (tiap byte -> `\xNN`, ~4x). Untuk
// skrip ini (puluhan KB) masih aman untuk HttpGet, tapi kalau skrip membesar jauh, pertimbangkan
// menonaktifkan `wrapWhole` dan cukup pakai langkah 1-3.

// ---------- util dasar ----------

function randomByteKey(length = 8): number[] {
  const arr: number[] = [];
  for (let i = 0; i < length; i += 1) arr.push(1 + Math.floor(Math.random() * 254));
  return arr;
}

function randomIdent(prefix: string): string {
  // a-z0-9, tidak diawali angka, cukup unik untuk satu respons (bukan untuk keamanan kriptografis).
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 6; i += 1) s += chars[Math.floor(Math.random() * chars.length)];
  return `${prefix}${s}`;
}

function xorBytes(input: string, key: number[]): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    if (code > 255) throw new Error('xorBytes: hanya mendukung sumber ASCII/Latin-1');
    bytes.push(code ^ key[i % key.length]);
  }
  return bytes;
}

// Lua string literal berisi escape hex `\xNN` per byte — ini representasi "string jadi HEX"
// yang diminta, dan juga membuat payload tidak tampil sebagai teks biasa di hasil curl/dekompilasi.
function bytesToHexLuaLiteral(bytes: number[]): string {
  return `"${bytes.map((b) => `\\x${b.toString(16).padStart(2, '0')}`).join('')}"`;
}

// PENTING: Luau (dialek Lua milik Roblox) TIDAK mendukung operator bitwise native dari Lua 5.3+
// (`~`, `&`, `|`, `<<`, `>>`) sama sekali — itu keputusan desain Roblox, bukan sesuatu yang hilang
// di versi tertentu. Satu-satunya cara bitwise XOR di Luau adalah lewat library `bit32`, yang
// SELALU tersedia sebagai global bawaan di setiap lingkungan Roblox/Luau (termasuk executor pihak
// ketiga). Jangan pernah pakai token `~` di skrip yang dikirim ke Roblox — itu bikin loadstring()
// gagal compile sejak baris pertama (nil + pesan error), dan skrip jadi tidak jalan sama sekali.
function decoderStub(fnName: string, keyName: string, key: number[]): string {
  return [
    `local ${keyName} = {${key.join(',')}}`,
    `local function ${fnName}(s)`,
    '\tlocal out = {}',
    '\tfor i = 1, #s do',
    `\t\tlocal k = ${keyName}[((i - 1) % #${keyName}) + 1]`,
    '\t\tout[i] = string.char(bit32.bxor(string.byte(s, i), k))',
    '\tend',
    '\treturn table.concat(out)',
    'end',
  ].join('\n');
}

// Membungkus seluruh skrip dalam percabangan yang terbukti selalu benar (seed % 2 == seed % 2),
// sehingga perilaku runtime tidak berubah, tetapi mengganggu analisis statis/dekompilasi naif
// yang mengharapkan kode berjalan linear dari baris pertama.
function withJunkControlFlow(body: string, seed = Math.floor(Math.random() * 1_000_000)): string {
  const guard = `__dbde_g${seed}`;
  const dead = `__dbde_d${seed}`;
  return [
    `local ${guard} = (${seed} % 2 == ${seed % 2}) and (${seed} + 1 > ${seed})`,
    `if ${guard} then`,
    body,
    'else',
    `\tlocal ${dead} = ${seed} * 2 -- unreachable: anti-analisis statis`,
    `\tif ${dead} < 0 then error('unreachable') end`,
    'end',
  ].join('\n');
}

// ---------- scanner token Lua minimal (untuk rename lokal yang aman) ----------
// Cukup untuk membedakan: komentar, string (biasa & long bracket), identifier, dan karakter lain.
// TIDAK mem-parse seluruh grammar Lua — hanya cukup untuk tugas rename token identifier dengan aman.

type Token =
  | { kind: 'ident'; text: string }
  | { kind: 'string' | 'comment' | 'other'; text: string };

function tokenizeLua(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = src.length;

  const readLongBracket = (start: number): number | null => {
    // di posisi start ada '[' ; cek pola [=*[ ... ]=*]
    let j = start + 1;
    let eqs = 0;
    while (src[j] === '=') { eqs += 1; j += 1; }
    if (src[j] !== '[') return null;
    j += 1;
    const closer = `]${'='.repeat(eqs)}]`;
    const end = src.indexOf(closer, j);
    return end === -1 ? n : end + closer.length;
  };

  while (i < n) {
    const c = src[i];

    // komentar
    if (c === '-' && src[i + 1] === '-') {
      if (src[i + 2] === '[') {
        const lb = readLongBracket(i + 2);
        if (lb !== null) {
          tokens.push({ kind: 'comment', text: src.slice(i, lb) });
          i = lb;
          continue;
        }
      }
      const nl = src.indexOf('\n', i);
      const end = nl === -1 ? n : nl;
      tokens.push({ kind: 'comment', text: src.slice(i, end) });
      i = end;
      continue;
    }

    // string panjang [[ ]] / [=[ ]=]
    if (c === '[' && (src[i + 1] === '[' || src[i + 1] === '=')) {
      const lb = readLongBracket(i);
      if (lb !== null) {
        tokens.push({ kind: 'string', text: src.slice(i, lb) });
        i = lb;
        continue;
      }
    }

    // string biasa ' atau "
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c) {
        if (src[j] === '\\') j += 1;
        j += 1;
      }
      j = Math.min(j + 1, n);
      tokens.push({ kind: 'string', text: src.slice(i, j) });
      i = j;
      continue;
    }

    // identifier / keyword
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_]/.test(src[j])) j += 1;
      tokens.push({ kind: 'ident', text: src.slice(i, j) });
      i = j;
      continue;
    }

    tokens.push({ kind: 'other', text: c });
    i += 1;
  }

  return tokens;
}

const LUA_KEYWORDS = new Set([
  'and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function', 'goto', 'if', 'in',
  'local', 'nil', 'not', 'or', 'repeat', 'return', 'then', 'true', 'until', 'while',
]);

// Nama yang TIDAK BOLEH pernah di-rename: keyword, global/service Roblox, dan API bawaan Lua yang
// dipakai skrip ini. Daftar whitelist (bukan blacklist) akan lebih aman, tapi skrip ini memakai
// banyak nama Roblox API yang tidak terdaftar statis (field objek Instance dibuat dinamis), jadi
// dipakai blacklist eksplisit + aturan konteks (lihat renameLocalIdentifiers) sebagai pengaman kedua.
const NEVER_RENAME = new Set([
  'game', 'workspace', 'script', 'shared', '_G', 'Enum', 'Vector2', 'Vector3', 'Color3', 'UDim2',
  'UDim', 'TweenInfo', 'Instance', 'Players', 'MarketplaceService', 'HttpService', 'TweenService',
  'UserInputService', 'RunService', 'Stats', 'bit32', 'string', 'table', 'math', 'os', 'coroutine',
  'pcall', 'xpcall', 'pairs', 'ipairs', 'tostring', 'tonumber', 'type', 'select', 'unpack', 'warn',
  'print', 'error', 'assert', 'rawget', 'rawset', 'rawequal', 'setmetatable', 'getmetatable',
  'loadstring', 'load', 'require', 'getgenv', 'syn', 'http', 'http_request', 'request', 'task',
  'LocalPlayer',
]);

// Mengekstrak kandidat nama lokal yang aman di-rename: hanya dari pola deklarasi
// `local <nama>` dan `local function <nama>` (bukan `for`, bukan parameter fungsi) — supaya tidak
// perlu melacak scope/shadowing sama sekali: tiap nama kandidat diganti satu nama baru yang sama
// di SELURUH skrip, dan itu aman persis karena skrip ini tidak men-shadow nama lokal top-level-nya
// sendiri. Parameter fungsi & variabel `for` dikecualikan (lihat collectNonLocalBindings).
function collectLocalDeclarations(tokens: Token[]): Set<string> {
  const found = new Set<string>();
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (t.kind !== 'ident' || t.text !== 'local') continue;
    let j = i + 1;
    while (j < tokens.length && tokens[j].kind === 'other' && /\s/.test(tokens[j].text)) j += 1;
    if (tokens[j]?.kind === 'ident' && tokens[j].text === 'function') {
      j += 1;
      while (j < tokens.length && tokens[j].kind === 'other' && /\s/.test(tokens[j].text)) j += 1;
      if (tokens[j]?.kind === 'ident') found.add(tokens[j].text);
      continue;
    }
    // `local a, b, c = ...` — ambil semua nama sebelum '='
    while (j < tokens.length) {
      const tk = tokens[j];
      if (tk.kind === 'ident') {
        found.add(tk.text);
        j += 1;
      } else if (tk.kind === 'other' && (tk.text === ',' || /\s/.test(tk.text))) {
        j += 1;
      } else {
        break;
      }
    }
  }
  // Parameter fungsi dan variabel `for` TIDAK ikut di-rename karena deklarasinya bukan `local`.
  // Kalau namanya kebetulan sama dengan sebuah `local` di tempat lain (mis. `pushHist(list, v)`
  // dan `local list = ...`), pemakaian di badan fungsi ikut diganti sementara parameternya tidak,
  // sehingga variabel menjadi nil saat runtime. Nama seperti itu dikeluarkan dari daftar rename.
  for (const name of collectNonLocalBindings(tokens)) found.delete(name);
  for (const name of NEVER_RENAME) found.delete(name);
  for (const name of LUA_KEYWORDS) found.delete(name);
  return found;
}

function collectNonLocalBindings(tokens: Token[]): Set<string> {
  const bound = new Set<string>();
  const isSpace = (t?: Token) => t?.kind === 'other' && /\s/.test(t.text);
  const skipSpace = (from: number) => {
    let j = from;
    while (j < tokens.length && isSpace(tokens[j])) j += 1;
    return j;
  };
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (t.kind !== 'ident') continue;

    if (t.text === 'function') {
      // lewati nama opsional (`a.b:c`), lalu baca daftar parameter di dalam ( ... )
      let j = skipSpace(i + 1);
      while (j < tokens.length && !(tokens[j].kind === 'other' && tokens[j].text === '(')) j += 1;
      j += 1;
      while (j < tokens.length && !(tokens[j].kind === 'other' && tokens[j].text === ')')) {
        if (tokens[j].kind === 'ident') bound.add(tokens[j].text);
        j += 1;
      }
    } else if (t.text === 'for') {
      // `for a, b in ...` / `for i = ...`: ambil semua identifier sampai `in` atau '='
      let j = i + 1;
      while (j < tokens.length) {
        const tk = tokens[j];
        if (tk.kind === 'ident' && tk.text !== 'in') bound.add(tk.text);
        else if (tk.kind === 'ident' && tk.text === 'in') break;
        else if (tk.kind === 'other' && tk.text === '=') break;
        j += 1;
      }
    }
  }
  return bound;
}

function nextNonSpace(tokens: Token[], from: number): Token | undefined {
  let j = from;
  while (j < tokens.length && tokens[j].kind === 'other' && /\s/.test(tokens[j].text)) j += 1;
  return tokens[j];
}

// true bila identifier di indeks `i` adalah nama field (`a.nama`) atau method (`a:nama`).
// Operator `..` (concat) dan `...` (vararg) juga tersusun dari token '.', tetapi identifier
// sesudahnya adalah variabel biasa (`"x" .. nama`) dan WAJIB ikut di-rename; kalau tidak,
// deklarasinya berganti nama sementara pemakaiannya tidak, dan skrip error saat dijalankan.
function isFieldOrMethodName(tokens: Token[], i: number): boolean {
  let j = i - 1;
  while (j >= 0 && tokens[j].kind === 'other' && /\s/.test(tokens[j].text)) j -= 1;
  const prev = j >= 0 ? tokens[j] : undefined;
  if (prev?.kind !== 'other') return false;
  if (prev.text === ':') return true;
  if (prev.text !== '.') return false;
  const beforeDot = j > 0 ? tokens[j - 1] : undefined;
  return !(beforeDot?.kind === 'other' && beforeDot.text === '.');
}

// Rename identifier lokal dengan aman:
//  - lewati token string & comment sepenuhnya (tidak pernah diubah)
//  - lewati identifier yang didahului '.' atau ':' (itu field/method access, bukan variabel lokal)
//  - lewati identifier yang berada tepat di dalam '{ ... }' DAN diikuti '=' tunggal (bukan '==') —
//    itu table-constructor key (`{ nama = nilai }`), bukan referensi variabel.
//    Di Lua, '{' SELALU berarti table constructor (tidak ada makna lain), jadi brace-depth > 0
//    sudah cukup untuk mendeteksi konteks ini tanpa parser penuh.
export function renameLocalIdentifiers(source: string): string {
  const tokens = tokenizeLua(source);
  const toRename = collectLocalDeclarations(tokens);
  if (toRename.size === 0) return source;

  const nameMap = new Map<string, string>();
  for (const name of toRename) nameMap.set(name, randomIdent('v_'));

  let braceDepth = 0;
  let out = '';
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (t.kind === 'other') {
      if (t.text === '{') braceDepth += 1;
      else if (t.text === '}') braceDepth = Math.max(0, braceDepth - 1);
      out += t.text;
      continue;
    }
    if (t.kind === 'comment') {
      // Komentar asli tidak dipertahankan di jalur obfuscate (akan diganti header baru),
      // tapi tetap aman dibiarkan: tidak memengaruhi eksekusi.
      out += t.text;
      continue;
    }
    if (t.kind === 'string') {
      out += t.text;
      continue;
    }
    // ident
    if (!nameMap.has(t.text)) {
      out += t.text;
      continue;
    }
    if (isFieldOrMethodName(tokens, i)) {
      // akses field/method dengan nama yang kebetulan sama — bukan variabel lokal kita, jangan ubah
      out += t.text;
      continue;
    }
    if (braceDepth > 0) {
      const next = nextNonSpace(tokens, i + 1);
      const afterNext = next ? nextNonSpace(tokens, tokens.indexOf(next) + 1) : undefined;
      const isTableKey = next?.kind === 'other' && next.text === '=' && !(afterNext?.kind === 'other' && afterNext.text === '=');
      if (isTableKey) {
        out += t.text; // table-constructor key, bukan referensi variabel — jangan ubah
        continue;
      }
    }
    out += nameMap.get(t.text)!;
  }
  return out;
}

// ---------- API utama ----------

export interface ObfuscateOptions {
  renameLocals?: boolean; // default true
  wrapWhole?: boolean; // default true — bungkus hasil akhir dalam loadstring/pcall ter-enkripsi
}

export interface ObfuscateResult {
  source: string;
  method: string;
}

// `source`  : skrip Lua yang endpoint-nya SUDAH disubstitusi (alamat asli, bukan placeholder).
// `secrets` : daftar string sensitif yang perlu dienkripsi jika ditemukan sebagai literal
//             `KEY = "<nilai>"` di dalam skrip (mis. CONFIG.URL). Nilai yang tidak ditemukan dilewati.
export function obfuscateLuaSource(
  source: string,
  secrets: { configField: string; value: string }[],
  options: ObfuscateOptions = {},
): ObfuscateResult {
  const { renameLocals = true, wrapWhole = true } = options;
  let out = source;
  const decoders: string[] = [];

  secrets.forEach(({ configField, value }) => {
    const literal = `${configField} = "${value}"`;
    if (!out.includes(literal)) return;
    const key = randomByteKey();
    const fnName = randomIdent('d_');
    const keyName = randomIdent('k_');
    decoders.push(decoderStub(fnName, keyName, key));
    out = out.replace(literal, `${configField} = ${fnName}(${bytesToHexLuaLiteral(xorBytes(value, key))})`);
  });

  if (renameLocals) out = renameLocalIdentifiers(out);

  const header = decoders.length
    ? `--[[ dbdataentry: skrip dilindungi (enkripsi string + rename lokal + control-flow) ]]\n${decoders.join('\n')}\n`
    : '--[[ dbdataentry: skrip dilindungi (rename lokal + control-flow) ]]\n';

  const controlFlowWrapped = withJunkControlFlow(`${header}${out}`);

  if (!wrapWhole) {
    return { source: controlFlowWrapped, method: 'string-encryption+rename-locals+control-flow' };
  }

  return { source: wrapInLoadstring(controlFlowWrapped), method: 'string-encryption+rename-locals+control-flow+loadstring-wrap' };
}

// Mengenkripsi SELURUH skrip (bukan cuma endpoint) dan membungkusnya dalam bootstrap pendek yang
// men-decode lalu menjalankannya lewat loadstring + pcall. Yang tersaji ke jaringan jadinya hanya
// bootstrap + satu string hex panjang: tidak bisa dibaca langsung tanpa menjalankannya.
function wrapInLoadstring(fullSource: string): string {
  const key = randomByteKey(16);
  const keyName = randomIdent('bk_');
  const decName = randomIdent('bd_');
  const blobName = randomIdent('bs_');
  const chunkName = randomIdent('bc_');
  const errName = randomIdent('be_');
  const okName = randomIdent('bo_');

  const blob = bytesToHexLuaLiteral(xorBytes(fullSource, key));

  return [
    '--[[ dbdataentry: skrip ter-enkripsi penuh — dieksekusi via loadstring saat runtime ]]',
    `local ${keyName} = {${key.join(',')}}`,
    `local ${blobName} = ${blob}`,
    `local function ${decName}(s)`,
    '\tlocal out = {}',
    '\tfor i = 1, #s do',
    `\t\tlocal k = ${keyName}[((i - 1) % #${keyName}) + 1]`,
    '\t\tout[i] = string.char(bit32.bxor(string.byte(s, i), k))',
    '\tend',
    '\treturn table.concat(out)',
    'end',
    `local ${chunkName}, ${errName} = loadstring(${decName}(${blobName}))`,
    `if not ${chunkName} then`,
    `\twarn("[dbdataentry] Gagal memuat skrip terenkripsi: " .. tostring(${errName}))`,
    '\treturn',
    'end',
    `local ${okName}, ${errName} = pcall(${chunkName})`,
    `if not ${okName} then`,
    `\twarn("[dbdataentry] Skrip berhenti dengan error: " .. tostring(${errName}))`,
    'end',
  ].join('\n');
}

// Titik integrasi untuk layanan eksternal (WeAreDevs API / Lua Obfuscator) bila API key
// tersedia di masa depan. Saat ini tidak dipanggil di mana pun — menunggu WEAREDEVS_API_KEY.
export async function externalObfuscate(source: string, apiKey: string): Promise<string> {
  const res = await fetch('https://api.luaobfuscator.com/v1/obfuscate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: apiKey },
    body: JSON.stringify({ script: source }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Obfuscation eksternal gagal (${res.status})`);
  const data = (await res.json()) as { script?: string };
  if (!data.script) throw new Error('Respons obfuscation eksternal tidak valid');
  return data.script;
}
