# dbdataentry v4

Dashboard Next.js (App Router, TypeScript, Tailwind v4, Motion) untuk menerima webhook dari sumber mana pun dan memantau status akun secara real-time. Penyimpanan di Upstash Redis, siap deploy di Vercel.

## Stack

Backend memakai **Opsi C**: route handler Next.js (runtime Node.js). Alasannya: semua kebutuhan (header geolokasi `x-vercel-ip-*`, `/tmp` untuk staging, Environment Variables) bersifat native di Vercel; Go/Rust akan menambah satu runtime terpisah tanpa manfaat yang terukur pada beban webhook ini. Bagian kriptografi memakai Rust lewat `@node-rs/argon2` (Argon2id).

## Setup

1. `npm install`
2. Isi Environment Variables (Vercel > Settings > Environment Variables, atau `.env.local` untuk lokal). Contoh lengkap: `.env.example`.

| Variabel | Wajib | Keterangan |
|---|---|---|
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | ya | Integrasi Upstash di Vercel mengisi `KV_REST_API_URL/TOKEN`; keduanya dikenali |
| `SUPERADMIN_USERNAME`, `SUPERADMIN_PASSWORD_HASH` | ya | Pemilik kredensial ini otomatis role **superadmin** permanen (tidak bisa diubah/ditangguhkan dari dashboard). `ADMIN_USERNAME`/`ADMIN_PASSWORD_HASH` (nama lama) tetap diterima sebagai alias. Hash: `npm run hash -- "password"` (Argon2id; bcrypt juga diterima) |
| `JWT_SECRET` | ya | Minimal 32 karakter acak |
| `ENCRYPTION_KEY` | tidak* | Hex 32-byte (64 karakter) untuk AES-256-GCM. Wajib hanya jika Superadmin mengisi Webhook Secret / API Key di tab **Sistem** |
| `WEBHOOK_INGEST_TOKEN` | tidak | Jika diisi, endpoint universal menolak request tanpa token (`x-api-key`, `Authorization: Bearer`, atau `?key=`) |
| `LOG_MAX_PER_TABLE`, `LOG_MAX_STREAM`, `MAX_GAME_TABLES` | tidak | Batas penyimpanan (default 500 / 500 / 100) |
| `GEOIP_ISP_LOOKUP=off` | tidak | Mematikan lookup ISP eksternal saat login |
| `STREAM_INTERVAL_MS`, `REDIS_MEMORY_LIMIT_MB` | tidak | Interval SSE (default 4000) dan batas memori paket Redis |

Di file `.env`, setiap `$` pada hash ditulis `\$`. Di dashboard Vercel tidak perlu.

Variabel yang belum diisi tidak membuat build gagal: login menjawab 503 generik, nama variabelnya dicatat di log server, dan tab **Sistem** (admin) menampilkan status tiap variabel.

3. `npm run dev`, atau `npm run build && npm start`.

## Endpoint

| Endpoint | Akses | Fungsi |
|---|---|---|
| `POST /api/receiver/universal` | terbuka | Terima JSON, URL-encoded, form-data, atau teks mentah. Game dikenali dari `game_name`, `gameName`, `game`, `game_id`, `source`, dan kunci serupa (juga bersarang, header `x-game-name`, atau `?game=`). Tabel baru dibuat otomatis |
| `GET /scripts/account_status.lua` | terbuka | Script Lua, alamat endpoint diisi dari domain yang melayani. Tanpa API key |
| `/api/auth/{login,register,logout,me}` | publik / sesi | JWT di cookie HttpOnly, Secure, SameSite=Strict |
| `/api/games`, `/api/games/[slug]` | sesi; tulis = admin | Daftar, buat, ganti nama, hapus tabel |
| `/api/logs?game=` | sesi; DELETE = admin | Baca / Clear Logs |
| `/api/accounts` | sesi; DELETE = admin | Akun yang dilacak |
| `/api/stream?game=&limit=` | sesi | SSE |
| `/api/admin/users`, `/api/admin/users/[username]` | staf (baca) / superadmin (ubah) | Daftar pengguna; approve/reject/suspend & ubah role (admin↔viewer) |
| `/api/admin/settings` | superadmin | Mode maintenance + teks kustomnya, rate limit, sakelar proteksi skrip Lua, "Wajibkan API Key", retensi log, Webhook Secret (AES-256-GCM), status enkripsi |
| `/api/admin/apikey` | superadmin | Daftar / buat (label, masa berlaku) / cabut (`?id=`) API Key |
| `/api/admin/audit?limit=` | superadmin | Jejak audit aksi sensitif |
| `/api/admin/encryption/rotate` | superadmin | Enkripsi ulang secret dengan `ENCRYPTION_KEY` saat ini |
| `/api/admin/retention` | superadmin | Jalankan pembersihan retensi sekarang |
| `/api/cron/retention` | `CRON_SECRET` | Dipanggil Vercel Cron harian (`vercel.json`) |
| `/api/logs/export?game=&format=csv\|json` | sesi | Ekspor penuh semua log tersimpan (bukan hanya yang dimuat di layar) |

## RBAC berjenjang

| Role | Akses |
|---|---|
| **Superadmin** (dari `.env`, permanen) | Semua halaman/API. Satu-satunya yang approve/reject pendaftaran, kelola pengguna, Pengaturan Sistem, API Key, Webhook Secret, proteksi skrip Lua |
| **Admin** | CRUD Akun & Game, ekspor CSV/JSON, lihat daftar pengguna & log. Tidak bisa approve pendaftaran atau mengubah Pengaturan Sistem |
| **Viewer** (default pendaftar baru) | Baca saja di Ringkasan, Log, Akun, Game. Semua aksi mutasi disembunyikan di UI dan diblokir di API |

Pendaftar baru berstatus **pending** dan diarahkan ke `/pending-approval` sampai Superadmin menyetujui dari tab **Pengguna**.

## API Key, audit, retensi, rotasi kunci

- **API Key**: banyak key berlabel dengan masa berlaku opsional, dibuat dan dicabut sendiri-sendiri di tab **Sistem**. Hanya hash SHA-256 yang disimpan; nilai key tampil sekali. Key dikirim lewat `x-api-key`, `Authorization: Bearer`, atau `?key=`. Secara bawaan endpoint receiver tetap **terbuka**. Sakelar **Wajibkan API Key** menolak request tanpa key valid (401); skrip Lua bawaan tidak membawa key, jadi ikut ditolak bila sakelar dinyalakan. `WEBHOOK_INGEST_TOKEN` (env) tetap berlaku dan, bila diisi, selalu mewajibkan kredensial.
- **Rate limit** memakai angka dari tab Sistem (bawaan 600/menit): per **API Key** untuk request ber-key, per **IP** untuk selebihnya.
- **Audit log**: pelaku, aksi, target, dan IP untuk perubahan pengaturan, API Key, saklar receiver, pengguna, hapus log/tabel/akun, rotasi, dan retensi. Nilai rahasia tidak pernah dicatat. Maksimal 1.000 entri terbaru (`audit:log`). Gagal mencatat tidak menggagalkan aksinya.
- **Mode maintenance** (tab Sistem > Pengaturan Dinamis): saat nyala, `/api/receiver/*` dan `/api/webhook` menjawab **503** `{ "success": false, "maintenance": true, "message": "..." }` dengan `Retry-After: 60`, termasuk untuk request ber-API Key. Dicek di `proxy.ts` (pintu depan) dan di `lib/ingest/handler.ts` (pagar terakhir). Dashboard, login, API admin, cron, dan `/scripts/*` tetap terbuka. Teks maintenance (maks. 200 karakter, kosong = teks bawaan) bisa diubah kapan saja. Skrip Lua mengecek `GET /api/maintenance` (publik, tanpa data akun, `no-store`) tiap 5 detik, jadi mode dan teks tampil di panel dalam sekitar 5 sampai 15 detik tanpa memuat ulang skrip. Saat maintenance, panel menyembunyikan semua fitur (kartu statistik, grafik, tombol) dan hanya menampilkan kartu maintenance; pengiriman data dijeda dan lanjut sendiri begitu maintenance dimatikan. Skrip versi lama (dimuat sebelum fitur ini) tidak punya pengecekan itu dan harus dijalankan ulang sekali. Bila Redis gagal dibaca, request tetap lolos.
- **Keamanan receiver**: hitungan 24 jam terakhir untuk HMAC gagal, kredensial ditolak, dan kena rate limit.
- **Retensi log**: hapus log lebih tua dari N hari (0 = mati), manual lewat tombol atau otomatis harian 03:00 UTC lewat Vercel Cron (butuh `CRON_SECRET`). Pemangkasan dari ekor list secara atomik; hanya key log yang disentuh.
- **Rotasi `ENCRYPTION_KEY`**: isi `ENCRYPTION_KEY_PREVIOUS` dengan kunci lama, redeploy, klik **Enkripsi ulang sekarang**, lalu hapus variabel itu. Selama rotasi secret tetap terbaca (HMAC tidak putus). Penulisan memakai compare-and-set sehingga secret yang baru diganti tidak tertimpa.

## Proteksi skrip Lua

Sakelar "Proteksi Skrip Lua" di tab **Sistem** (Superadmin) mengaktifkan enkripsi string (endpoint webhook) + control-flow obfuscation sebelum skrip disajikan ke `/scripts/account_status.lua`. Skema ini berjalan sepenuhnya di server (tanpa API key pihak ketiga); titik integrasi untuk layanan eksternal (WeAreDevs API dsb.) tersedia di `lib/lua/obfuscate.ts` bila suatu saat dibutuhkan.
| `/api/system`, `/api/system/receiver`, `/api/admin/users[/…/devices]` | admin | Status sistem, saklar receiver, pengguna + riwayat perangkat |

Alias lama tetap hidup supaya script dan webhook yang sudah terpasang tidak putus: `/api/webhook` dan `/api/receiver/dice` (masuk ke tabel Anime Dice jika payload tidak memuat identitas), `/api/receiver/account` dan `/api/receiver/game` (status akun). Hapus foldernya jika tidak dipakai.

Status akun dikenali dari `"type": "account_status"` di payload. Webhook pihak ketiga yang kebetulan memuat field `username` tidak membuat akun palsu. Heartbeat rutin hanya memperbarui akun; log ditulis saat sesi mulai (`Online`), `Offline`, atau event lain.

## Struktur Redis

```
logs:stream                 semua log (list, terbaru di depan)
game:<slug>:logs            log per tabel game
games:meta | games:counts | games:alias    metadata, total diterima, alias setelah rename
tracker:accounts            status akun Roblox
config:apikeys              hash SHA-256 API Key -> metadata (key asli tidak disimpan)
config:apikeys:used         id key -> waktu terakhir dipakai
audit:log                   jejak audit (list, maks 1.000)
stats:security:<YYYY-MM-DD> hitungan penolakan per jam (kedaluwarsa 3 hari)
users:account:<username>    akun terdaftar (hash Argon2id)
users:list                  daftar username (sorted set)
users:devices:<username>    riwayat perangkat/IP/lokasi login (maks 50)
```

**Clear Logs** hanya menghapus `logs:stream` dan/atau `game:<slug>:logs` (daftar putih di `lib/keys.ts`). Seluruh `users:*`, `tracker:accounts`, dan metadata tabel tidak disentuh; ada tes yang membuktikannya.

## Alur webhook (staging → Redis)

Body mentah ditulis ke `/tmp/dbdataentry-staging` bersama checksum SHA-256 dan Content-Length, dibaca ulang dan diverifikasi (terpotong atau korup → ditolak), diurai, lalu ditulis ke Redis dalam **satu EVAL atomik** (log stream + log tabel + metadata/penghitung tabel + status akun). File staging dihapus di `finally`, berhasil maupun gagal; sisa karena proses mati disapu otomatis (>2 menit). Redis gagal → 503 + `Retry-After`, tanpa file sampah.

Catatan jujur: `/tmp` di Vercel hanya per-instance dan tidak tahan lama, jadi staging berfungsi sebagai gerbang verifikasi integritas, bukan antrean. Jika `/tmp` tidak bisa ditulis, payload tetap diproses dari memori.

## Keamanan yang perlu diketahui

- Endpoint universal **terbuka tanpa autentikasi** sesuai permintaan. Pengaman yang ada: batas 256 KB, rate limit (bawaan 600/menit, dapat diubah di tab Sistem) per IP atau per API Key, batas jumlah tabel dan log, sanitasi kunci/kedalaman payload, serta nama tabel yang dipetakan ke slug `a-z0-9-` (tidak bisa menyusup ke key lain). Siapa pun yang tahu URL-nya bisa menulis data; isi `WEBHOOK_INGEST_TOKEN` atau nyalakan **Wajibkan API Key** untuk menutupnya.
- Script Lua dibaca siapa pun yang memegang URL-nya, karena itu tidak memuat rahasia.
- Vercel tidak menyediakan nama ISP di header-nya. ISP dicari lewat `ipwho.is` (best effort, timeout 1,5 dtk) dan itu mengirim IP pengguna ke layanan pihak ketiga; matikan dengan `GEOIP_ISP_LOOKUP=off`.
- Cookie `SameSite=Strict`: membuka dashboard lewat tautan dari situs lain meminta login ulang sekali.
- JWT bersifat stateless (8 jam). Menghapus pengguna tidak langsung memutus sesi yang sudah berjalan.

## Migrasi dari v3

| Lama | Baru |
|---|---|
| `DASHBOARD_USER` / `DASHBOARD_PASS_HASH` / `SESSION_SECRET` | `ADMIN_USERNAME` / `ADMIN_PASSWORD_HASH` / `JWT_SECRET` |
| `RECEIVER_API_KEY` | dihapus (script Lua tanpa key) |
| Key Redis `webhook_logs`, `account_status`, `webhook_quarantine`, `webhook:status` | `logs:stream`, `tracker:accounts`, (karantina dihapus), `config:receiver_enabled` |

Data lama tidak dimigrasi: log kosong di awal dan akun terisi lagi dari heartbeat berikutnya. Key lama bisa dihapus manual dari Upstash.

## Struktur proyek

```
app/            halaman (login, register, dashboard) dan route API
components/     ui, forms, charts, tables, views, dashboard
lib/            env, redis, keys, crypto, settings, apikeys, audit, securityStats, retention, auth/, ingest/ (parse, detect, staging, store, handler), games, users, device, lua/
schemas/        Zod
types/          tipe TypeScript bersama
public/         robots.txt
scripts/        hash-password.mjs
tests/          Vitest
proxy.ts        gerbang login (Next 16)
```

## Pengujian

`npm test`. Tes integrasi memakai Redis sungguhan (script Lua dijalankan di server Redis) dan otomatis dilewati jika tidak ada Redis di `TEST_REDIS_PORT` (default 6390): `redis-server --port 6390`.
