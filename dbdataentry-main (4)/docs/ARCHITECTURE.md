# dbdataentry v5.2: arsitektur & integrasi

Dokumen ini menjelaskan *mengapa* rancangannya begini. Kode ada di `lib/`, `app/api/`, `components/`; setiap modul punya tes di `tests/`.

## 1. Prinsip penataan berkas

* **`lib/` murni dan teruji, `app/api/` tipis.** Route hanya: autentikasi/izin -> validasi (zod) -> panggil `lib/` -> audit. Logika yang bisa diuji tanpa HTTP tidak boleh hidup di route.
* **Satu arah dependensi:** `app/` & `components/` -> `lib/<fitur>` -> `lib/redis`, `lib/keys`. Modul fitur tidak saling menunjuk melingkar; titik temu lintas fitur adalah `emitAlert` (notifikasi) dan `lib/security/crypto`.
* **Tambah, jangan timpa.** Tidak ada kontrak lama yang diubah: 118 tes asli tetap lulus tanpa diedit (satu-satunya kontrak yang disesuaikan adalah `inspectSecrets`/`reencryptSecrets`, yang sekarang juga mencakup kredensial notifikasi).

```
lib/
  security/crypto/   keyring.ts  envelope.ts  rotation.ts  index.ts      <- Bagian 2
  rbac/              permissions.ts (matriks peran->izin)  guard.ts      <- Bagian 6
  notify/            types.ts text.ts transport.ts config.ts dispatcher.ts emit.ts
                     adapters/{discord,telegram,index}.ts                <- Bagian 4
  ingest/            process.ts (inti bersama) queue.ts drain.ts handler.ts <- Bagian 5
  i18n/              config.ts detect.ts format.ts load.ts server.ts dictionaries/{en,id,ja,zh}.ts <- Bagian 3
  sessions.ts  logSearch.ts  background.ts  cronAuth.ts
app/api/
  sessions/  admin/{notifications,notifications/test,queue}/  logs/{search,export}/
  cron/{ingest-drain,crypto-rotate,retention}/
components/
  i18n/{I18nProvider,LanguageSwitcher}.tsx   motion/{variants,Stagger,AnimatedRow}
  views/SessionsView.tsx  views/logs/ServerLogSearch.tsx
  views/system/{NotificationsPanel,QueuePanel}.tsx
```

## 2. Enkripsi berlapis

```
payload --AES-256-GCM(DEK acak, iv 96-bit, AAD=konteks|iv)--> ciphertext
DEK     --ChaCha20-Poly1305(wrapKey, nonce 96-bit, AAD=kid|konteks|iv)--> wrapped DEK
seluruh amplop --HMAC-SHA256(macKey)--> tag
format: dbde2.<kid>.<wrapNonce>.<wrappedDEK>.<iv>.<ciphertext>.<mac>   (base64url)
```

| Keputusan | Alasan |
|---|---|
| **DEK baru per transaksi** | GCM dengan IV acak 96-bit aman hanya sampai ~2^32 pesan per kunci (peluang tabrakan ~ n²/2^97). Dengan satu DEK untuk satu pesan, n = 1 selamanya; batas itu hilang. |
| **Dua keluarga primitif** (AES blok vs ChaCha ARX) | Kelemahan pada satu keluarga tidak otomatis membuka DEK *dan* data. |
| **HKDF-SHA256 dari KEK** menjadi `wrapKey` dan `macKey` | Pemisahan domain: byte KEK mentah tidak pernah dipakai langsung untuk dua primitif berbeda. |
| **HMAC diverifikasi lebih dulu** (encrypt-then-MAC), waktu-konstan | Amplop rusak ditolak sebelum dekripsi apa pun berjalan, tanpa membedakan penyebab (tanpa oracle). GCM/Poly1305 tetap mengautentikasi di lapisan dalam. |
| **Konteks** (mis. `settings:API_KEY`, `notify:channel`) masuk AAD dan HMAC | Ciphertext tidak bisa dipindah antar field oleh pihak yang bisa menulis ke Redis. Diuji. |
| **`kid` = SHA-256(kunci) terpotong** | Pembuka langsung memilih KEK yang benar, tanpa trial-decryption dan tanpa konfigurasi id. |
| **AAD payload tidak memuat `kid`** | `kid` berubah saat rotasi sedangkan ciphertext tidak boleh disentuh. `kid` tetap terlindungi MAC dan AAD pembungkus. (Cacat ini sempat ada di rancangan awal dan tertangkap tes sebelum dipakai.) |

**Rotasi KEK** = `rewrap`: hanya DEK 48 byte yang dibongkar dan dibungkus ulang; payload tidak didekripsi. Biaya O(1) per rekaman berapa pun ukurannya, ciphertext identik (diuji), idempoten, ditulis dengan compare-and-set sehingga nilai yang baru diubah pengguna tidak tertimpa.

* **Manual:** tombol "Enkripsi ulang" Superadmin -> `POST /api/admin/encryption/rotate`.
* **Otomatis:** `GET /api/cron/crypto-rotate` menyapu setelah operator mengganti env.
* **Batas yang jujur:** KEK hidup di Environment Variable yang tidak bisa diubah dari runtime Vercel, jadi *pembuatan* KEK baru tetap tindakan operator (atau KMS eksternal). Yang diotomatisasi adalah migrasinya. RSA-4096 untuk key wrapping *tidak* diimplementasikan (ChaCha20-Poly1305 dipilih karena KEK 32-byte cukup disimpan di env; RSA menuntut pengelolaan kunci privat). Titik perluasannya ada di `envelope.ts` (`unwrapDek`/`aeadSeal`).
* **Kompatibilitas:** format lama `iv:tag:data` tetap terbaca dan di-upgrade saat ditulis ulang atau disapu cron.
* **Cakupan:** secret pengaturan (`WEBHOOK_SECRET`, `API_KEY`) dan kredensial saluran notifikasi. Payload log *tidak* dienkripsi karena akan mematikan pencarian full-text; bila diperlukan, gunakan `sealJson` per field dengan blind index.

## 3. i18n tanpa pustaka

* Kamus `en` adalah sumber; `id/ja/zh` bertipe `Record<MessageKey,string>`, jadi **kunci hilang = galat kompilasi**. Tes tambahan memastikan kunci identik, tidak kosong, dan placeholder `{x}` sama di semua bahasa.
* Urutan: **cookie `dbde_lang` > `Accept-Language` (urut q, `zh-TW`->`zh`, `in`->`id`) > `en`**. Server menentukan bahasa sebelum render, jadi tidak ada kedip. Cookie tidak sah diabaikan.
* Hanya kamus bahasa aktif yang dikirim ke klien; bahasa lain dimuat lewat `import()` dinamis saat dipilih. Pilihan disimpan di cookie (dibaca server) dan `localStorage` (cadangan bila cookie dihapus).
* **Cakupan terjemahan saat ini:** navigasi, header, halaman login/daftar, Sesi, panel Notifikasi, panel Antrean, pencarian log server, label peran. **Komponen lama** (Ringkasan, Game, Akun, Analitik, Pengguna, panel Sistem lama, dialog) dan **pesan galat dari API** masih berbahasa Indonesia. Infrastrukturnya selesai; sisanya dimigrasi bertahap: ganti string dengan `t('kunci')` dan tambahkan kunci ke keempat kamus (kompiler akan mengingatkan bila ada yang terlewat).

## 4. Notifikasi terpadu

`AlertEvent` (standar) -> `dispatchAlert`: konfigurasi tersegel -> aktif? -> jenis dilanggan? -> severity >= minimum? -> **dedupe** (`SET NX EX` per `kind+dedupeKey`) -> `adapter.format` -> `sendWithRetry` -> catat hasil (tanpa rahasia). **Tidak pernah melempar**; pengiriman berjalan di latar (`after()`).

* **Keamanan input Superadmin:** Discord dipatok ke host `discord.com`/`discordapp.com`/`ptb`/`canary` + pola path webhook (anti-SSRF; host internal, `http`, userinfo, port, sub-domain tiruan ditolak, diuji). Telegram selalu `api.telegram.org`. `allowed_mentions: {parse: []}` mencegah `@everyone` dari teks pengguna. Teks Telegram di-escape HTML. `redirect: 'error'`.
* **Rahasia:** disegel sebelum ke Redis, tidak pernah dikembalikan ke browser (hanya petunjuk tersamar), dibuang dari pesan galat, tidak masuk audit/log. Mengosongkan kolom saat memperbarui = mempertahankan nilai tersimpan.
* **Retry:** backoff eksponensial + jitter; menghormati `retry_after` (429) tetapi menyerah bila terlalu lama untuk serverless (`maxWaitMs`).
* **Pemicu terpasang:** login dari IP baru (hanya bila sudah ada riwayat; Superadmin = critical), pendaftaran menunggu persetujuan, lonjakan HMAC/auth/rate-limit dan error ingest (ambang/jam), antrean menumpuk/penuh/dead-letter, kegagalan rotasi KEK, sesi dicabut admin.
* **Platform baru** = satu berkas adapter + satu baris di `adapters/index.ts`.

## 5. Antrean ingest

Produser `LPUSH` (O(1)) -> jawab **202**. Konsumen: `CLAIM` (RPOP -> ZADD inflight dengan lease) **atomik dalam satu EVAL Lua**, proses, lalu `ACK`; gagal -> `NACK` (kembali dengan attempts+1 atau dead-letter); fungsi mati -> `RECLAIM` setelah lease habis. Semantik **at-least-once**: duplikat hanya mungkin bila konsumen mati setelah menulis tetapi sebelum ACK (satu entri log ganda; status akun idempotent). Diuji: dua pengklaim serentak tanpa tumpang tindih, crash-recovery, item beracun, antrean penuh -> 503 + `Retry-After`, lonjakan 300 event serentak diproses tepat sekali.

* **Bawaan MATI** (tidak mengubah perilaku yang ada): nyalakan di tab Sistem. Mode nyala mengubah respons dari `200 stored` menjadi `202 queued`; skrip Lua yang memeriksa isi respons perlu diperiksa.
* **Memori:** worst case = `QUEUE_MAX_DEPTH` × (`QUEUE_MAX_ITEM_BYTES` × 4/3). Bawaan 5000 × 32 KB = 160 MB; praktisnya payload 1-3 KB -> ~15 MB. Turunkan keduanya bila paket Upstash kecil.
* **Pengurus:** dipicu setelah tiap enqueue (`after()`, satu pengurus berkat kunci Redis) + cron `/api/cron/ingest-drain` + tombol "Kuras sekarang". **Vercel Hobby membatasi cron harian**; `vercel.json` memakai jadwal harian agar deploy tidak ditolak. Di paket Pro ubah menjadi `* * * * *`.
* Kredensial (`?key=`) dibuang dari item sebelum diantre.

## 6. Sesi, RBAC, pencarian log

* **Sesi:** JWT tetap stateless, ditambah registri (`sess:u:<user>`) untuk tampilan dan **deny-list** (`sess:revoked:<sid>`, TTL = sisa umur token) untuk pencabutan. Dipilih deny-list karena JWT lama tak punya catatan; allow-list akan men-logout semua orang saat deploy. `getSession()` memeriksa deny-list dengan cache 3 dtk per instance -> pencabutan berlaku dalam **<= ~3 dtk**; Redis tak terjangkau = gagal-terbuka (tanpa Redis seluruh dashboard memang mati). Logout, penurunan role, penangguhan/penolakan pengguna **mencabut sesi di server** (sebelumnya klaim `role` di JWT bisa basi hingga 8 jam).
* **RBAC:** izin granular (`lib/rbac/permissions.ts`), peran = himpunan izin. ID peran tersimpan **tidak diubah** (`superadmin|admin|viewer`) agar akun & JWT lama valid; nama tampilan: Super Admin / Moderator-Analyst / User-Client. Tes memastikan hierarki ketat (viewer ⊂ admin ⊂ superadmin) dan kesetaraan dengan guard lama. Route baru memakai `requirePermission`; route lama tetap `requireAdmin/requireSuperadmin` (setara) dan dapat dimigrasi bertahap.
* **Pencarian log:** server memindai list Redis berbatas (<= 5000/tabel) dengan sintaks `"frasa"`, `-kecualikan`, `event:` `user:` `game:` `format:`; filter tanggal inklusif; **paginasi keyset** (stabil walau log baru masuk). Ekspor CSV/JSON/NDJSON **streaming** dengan filter yang sama; kontrak CSV lama dipertahankan. Bila batas log dinaikkan jauh, ganti dengan indeks (Upstash Search/RediSearch).

## 7. Animasi

Satu "bahasa gerak" di `components/motion/variants.ts` (spring + ease). Hanya `transform`/`opacity`. `MotionConfig reducedMotion="user"` sudah ada. `PageTransition` + `StaggerItem` (transisi halaman berjenjang), `AnimatedRow` (layout animation + exit pada tabel), `StatCard` (stagger masuk, hover elevation, tap), grafik (batang tumbuh dari dasar, garis digambar via `pathLength`), `AnimatedNumber` (mengikuti bahasa aktif), skeleton `SkeletonStat/Table/Chart` (shimmer).

## 8. Integrasi (langkah)

1. Salin berkas ke repo; `npm install` (tidak ada dependensi baru).
2. Env di Vercel: pastikan `ENCRYPTION_KEY` (hex 64) dan `CRON_SECRET` terisi. Opsional: variabel `QUEUE_*`, `SECURITY_SPIKE_PER_HOUR` (lihat `.env.example`).
3. Deploy. Rahasia lama (format `iv:tag:data`) tetap terbaca; cron `crypto-rotate` (atau tombol) meng-upgrade-nya ke amplop v2.
4. Superadmin: tab **Sistem** -> *Notifikasi alert* -> pilih Discord/Telegram, isi kredensial, **Simpan**, lalu **Kirim uji**.
5. Antrean: tab **Sistem** -> *Antrean ingest* -> nyalakan bila skrip game mengirim lonjakan.
6. Rotasi kunci: lihat komentar `ENCRYPTION_KEY_PREVIOUS` di `.env.example`.

## 9. Yang diverifikasi dan yang tidak

Diverifikasi: `tsc --noEmit` bersih; **183 tes lulus** (termasuk 118 asli) terhadap Redis sungguhan; `next build` produksi sukses; smoke HTTP pada server produksi (deteksi bahasa dari cookie/Accept-Language/default, cookie palsu diabaikan, semua endpoint baru 401 tanpa sesi, cron menolak tanpa secret).
**Belum diverifikasi:** tampilan dan interaksi UI di peramban sungguhan (animasi, dropdown bahasa, form webhook): hanya dibuild dan dites logikanya; pengiriman ke Discord/Telegram *sungguhan* (diuji dengan `fetch` tiruan, bukan layanan nyata); Upstash REST (tes memakai adapter ioredis ke Redis lokal, termasuk script Lua).
