'use client';
import { CheckCircle2, ShieldOff, XCircle } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Explainer } from '@/components/ui/Explainer';
import { Pill } from '@/components/ui/Pill';
import { Skeleton } from '@/components/ui/Skeleton';
import { ApiKeysPanel } from '@/components/views/system/ApiKeysPanel';
import { AuditPanel } from '@/components/views/system/AuditPanel';
import { NotificationsPanel } from '@/components/views/system/NotificationsPanel';
import { QueuePanel } from '@/components/views/system/QueuePanel';
import { EncryptionPanel } from '@/components/views/system/EncryptionPanel';
import { RetentionPanel } from '@/components/views/system/RetentionPanel';
import { SecurityPanel } from '@/components/views/system/SecurityPanel';
import { apiJson } from '@/lib/client';
import type { EnvReport } from '@/lib/env';
import type { EncryptionStatus, SecurityStats, SystemSettings } from '@/types';

interface SystemInfo { env: EnvReport; receiverEnabled: boolean; security?: SecurityStats; redis: { ok: boolean; pingMs: number | null; usedMemory: string; limit: string; percentage: string; commands: number; bandwidth: string } }
interface SettingsInfo { success: boolean; data: SystemSettings; encryptionReady: boolean; encryption: EncryptionStatus }

// Superadmin-only (lihat Sidebar & Dashboard): Environment Variables, Redis, Penerima webhook,
// Pengaturan Dinamis (maintenance, rate limit, proteksi skrip Lua), dan API Key.
export function SystemView({ toast }: { toast: (m: string, t?: 'success' | 'error' | 'info') => void }) {
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [settings, setSettings] = useState<SettingsInfo | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setInfo(await apiJson<SystemInfo>('/api/system', 'GET')); } catch (e) { toast(e instanceof Error ? e.message : 'Gagal memuat sistem', 'error'); }
    try { setSettings(await apiJson<SettingsInfo>('/api/admin/settings', 'GET')); } catch (e) { toast(e instanceof Error ? e.message : 'Gagal memuat pengaturan', 'error'); }
  }, [toast]);
  useEffect(() => { void load(); }, [load]);

  const toggleReceiver = async () => {
    if (!info) return;
    try { await apiJson('/api/system/receiver', 'POST', { enabled: !info.receiverEnabled }); toast(`Penerima webhook ${info.receiverEnabled ? 'dimatikan' : 'dinyalakan'}`, 'success'); void load(); } catch (e) { toast(e instanceof Error ? e.message : 'Gagal', 'error'); }
  };

  const patchSettings = async (patch: Partial<{ maintenanceMode: boolean; maintenanceMessage: string; rateLimitPerMin: number; luaObfuscationEnabled: boolean; apiKeyRequired: boolean; logRetentionDays: number; ingestQueueEnabled: boolean; webhookSecret: string }>) => {
    setBusy(true);
    try { setSettings(await apiJson<SettingsInfo>('/api/admin/settings', 'PUT', patch)); toast('Pengaturan disimpan', 'success'); } catch (e) { toast(e instanceof Error ? e.message : 'Gagal menyimpan', 'error'); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="glass p-5 lg:col-span-1">
          <h3 className="mb-3 text-sm font-semibold text-white">Environment Variables</h3>
          {!info ? <Skeleton className="h-40" /> : (
            <ul className="space-y-2.5 text-sm">
              {info.env.required.map((r) => (
                <li key={r.name} className="flex items-start gap-2">
                  {r.set ? <CheckCircle2 className="mt-0.5 size-4 flex-none text-emerald-400" aria-label="Terisi" /> : <XCircle className="mt-0.5 size-4 flex-none text-rose-400" aria-label="Belum diisi" />}
                  <div><div className="font-mono text-xs text-slate-200">{r.name}</div>{!r.set && <div className="text-xs text-rose-300">{r.note ?? 'Belum diatur di Vercel'}</div>}</div>
                </li>
              ))}
            </ul>
          )}
          <Explainer className="mt-4" title="Cara membaca daftar ini" items={[
            'Centang hijau berarti variabel terisi dan formatnya benar. Tanda merah berarti belum diisi atau formatnya salah; alasannya tampil di bawah namanya. Nilainya tidak pernah ditampilkan.',
            <><code className="text-slate-300">UPSTASH_REDIS_REST_URL</code> dan <code className="text-slate-300">UPSTASH_REDIS_REST_TOKEN</code> menghubungkan ke Redis. Variabel <code className="text-slate-300">KV_*</code> atau <code className="text-slate-300">STORAGE_*</code> dari integrasi Upstash di Vercel juga diterima.</>,
            <><code className="text-slate-300">SUPERADMIN_USERNAME</code> dan <code className="text-slate-300">SUPERADMIN_PASSWORD_HASH</code> adalah akun Superadmin. Hash harus berformat Argon2id atau bcrypt, dan di file .env tanda $ ditulis \$.</>,
            <><code className="text-slate-300">JWT_SECRET</code> menandatangani sesi login dan minimal 32 karakter. <code className="text-slate-300">ENCRYPTION_KEY</code> berupa hex 64 karakter dan dipakai mengenkripsi Webhook Secret dan API Key.</>,
            'Semua variabel diatur di Vercel. Setelah mengubahnya, redeploy agar nilainya terbaca.',
          ]} />
        </section>

        <section className="glass p-5">
          <h3 className="mb-3 text-sm font-semibold text-white">Upstash Redis</h3>
          {!info ? <Skeleton className="h-40" /> : !info.redis.ok ? <p className="text-sm text-rose-300">Tidak terhubung. Periksa variabel Redis di samping.</p> : (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-slate-500">Ping</dt><dd className="text-slate-200">{info.redis.pingMs} ms</dd>
              <dt className="text-slate-500">Memori</dt><dd className="text-slate-200">{info.redis.usedMemory} / {info.redis.limit} ({info.redis.percentage}%)</dd>
              <dt className="text-slate-500">Command</dt><dd className="text-slate-200">{info.redis.commands.toLocaleString('id-ID')}</dd>
              <dt className="text-slate-500">Bandwidth</dt><dd className="text-slate-200">{info.redis.bandwidth}</dd>
            </dl>
          )}
          <Explainer className="mt-4" title="Cara membaca angka ini" items={[
            'Ping adalah waktu balasan Redis dari server dashboard, diukur setiap panel dimuat.',
            'Memori adalah pemakaian dibanding batas paket Upstash Anda. Jika mendekati penuh, kurangi retensi log atau naikkan paket.',
            'Command adalah jumlah perintah yang sudah diproses Redis sejak penghitungnya mulai, bukan per hari. Paket gratis Upstash membatasi jumlah command.',
            'Bandwidth adalah total data yang keluar dari Redis.',
            'Jika tertulis "Tidak terhubung", periksa variabel Redis di panel Environment Variables.',
          ]} />
        </section>

        <section className="glass p-5">
          <h3 className="mb-3 text-sm font-semibold text-white">Penerima webhook</h3>
          {!info ? <Skeleton className="h-24" /> : (
            <div className="space-y-3">
              <Pill tone={info.receiverEnabled ? 'ok' : 'warn'} dot={info.receiverEnabled ? 'live' : 'static'}>{info.receiverEnabled ? 'Aktif' : 'Dimatikan'}</Pill>
              <p className="text-xs leading-relaxed text-slate-400">Saat dimatikan, payload dijawab 202 dan diabaikan. Pengirim tidak menerima error sehingga tidak mematikan webhook-nya sendiri.</p>
              <Button onClick={toggleReceiver} variant={info.receiverEnabled ? 'danger' : 'primary'}>{info.receiverEnabled ? 'Matikan' : 'Nyalakan'}</Button>
            </div>
          )}
          <Explainer className="mt-4" title="Cara kerja penerima" items={[
            'Penerima adalah pintu masuk semua kiriman dari skrip game dan webhook ke dashboard ini.',
            'Saat dimatikan, kiriman tetap diperiksa API Key dan rate limit-nya, lalu dijawab 202 dan datanya tidak disimpan.',
            'Karena pengirim menerima 202 dan bukan error, mereka tidak mematikan webhook-nya sendiri. Nyalakan lagi dan kiriman berikutnya langsung tersimpan.',
          ]} />
        </section>
      </div>

      {info?.security && <SecurityPanel stats={info.security} />}

      <section className="glass p-5">
        <h3 className="mb-1 text-sm font-semibold text-white">Pengaturan Dinamis</h3>
        <p className="mb-4 text-xs text-slate-500">Tersimpan di Redis (nilai sensitif dienkripsi AES-256-GCM). Hanya Superadmin.</p>
        {!settings ? <Skeleton className="h-40" /> : (
          <div className="grid gap-5 sm:grid-cols-2">
            <label className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/20 px-4 py-3">
              <span className="text-sm text-slate-200">Mode Maintenance</span>
              <input type="checkbox" disabled={busy} checked={settings.data.maintenanceMode} onChange={(e) => void patchSettings({ maintenanceMode: e.target.checked })} className="size-4 accent-cyan-400" />
            </label>
            <div className="sm:col-span-2">
              <label htmlFor="maintenance-message" className="mb-1.5 block text-sm text-slate-200">Teks Maintenance (tampil di panel skrip Lua)</label>
              <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const v = String(new FormData(e.currentTarget).get('message') ?? '').trim(); if (v !== settings.data.maintenanceMessage) void patchSettings({ maintenanceMessage: v }); }}>
                <input id="maintenance-message" key={settings.data.maintenanceMessage} name="message" type="text" maxLength={200} disabled={busy} defaultValue={settings.data.maintenanceMessage}
                  placeholder="Server sedang maintenance. Coba lagi beberapa saat lagi." className="field flex-1 text-sm" />
                <Button type="submit" disabled={busy}>Simpan</Button>
              </form>
              <p className="mt-1.5 text-xs text-slate-500">Maksimal 200 karakter. Kosongkan lalu simpan untuk memakai teks bawaan. Teks bisa diubah kapan saja, termasuk saat maintenance sedang nyala.</p>
            </div>
            <label className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/20 px-4 py-3">
              <span className="flex items-center gap-1.5 text-sm text-slate-200"><ShieldOff className="size-3.5" />Proteksi Skrip Lua (Obfuscation)</span>
              <input type="checkbox" disabled={busy} checked={settings.data.luaObfuscationEnabled} onChange={(e) => void patchSettings({ luaObfuscationEnabled: e.target.checked })} className="size-4 accent-cyan-400" />
            </label>
            <label className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/20 px-4 py-3 sm:col-span-2">
              <span className="text-sm text-slate-200">Rate Limit (request/menit)</span>
              <input type="number" min={10} max={100000} disabled={busy} defaultValue={settings.data.rateLimitPerMin}
                onBlur={(e) => { const n = Number(e.target.value); if (n && n !== settings.data.rateLimitPerMin) void patchSettings({ rateLimitPerMin: n }); }}
                className="field w-28 py-1.5 text-right text-sm" />
            </label>
            <div className="sm:col-span-2">
              <div className="mb-1.5 flex items-center justify-between text-sm text-slate-200">
                <span>Secret Token HMAC (Webhook Secret)</span>
                <Pill tone={settings.data.webhookSecretSet ? 'ok' : 'neutral'}>{settings.data.webhookSecretSet ? 'Terpasang' : 'Belum diatur'}</Pill>
              </div>
              <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); const v = String(f.get('secret') ?? '').trim(); if (v) void patchSettings({ webhookSecret: v }); e.currentTarget.reset(); }}>
                <input name="secret" type="password" placeholder="Secret baru…" className="field flex-1 text-sm" disabled={busy || !settings.encryptionReady} />
                <Button type="submit" disabled={busy || !settings.encryptionReady}>Simpan</Button>
                {settings.data.webhookSecretSet && <Button type="button" variant="danger" disabled={busy} onClick={() => void patchSettings({ webhookSecret: '' })}>Hapus</Button>}
              </form>
              {!settings.encryptionReady && <p className="mt-1.5 text-xs text-rose-300">ENCRYPTION_KEY belum diatur di Vercel — nilai sensitif tidak bisa dienkripsi.</p>}
            </div>
          </div>
        )}
        <Explainer className="mt-4" title="Cara kerja pengaturan ini" items={[
          'Semua pengaturan tersimpan di Redis dan berlaku tanpa redeploy. Hanya Superadmin yang bisa mengubahnya, dan setiap perubahan tercatat di Audit log.',
          'Mode Maintenance: saat nyala, semua kiriman ke penerima webhook (/api/receiver/* dan /api/webhook) ditolak dengan HTTP 503, termasuk yang memakai API Key. Dashboard, login, dan /scripts/* tetap terbuka. Skrip Lua menampilkan status Maintenance beserta teks di atas di panelnya, berhenti mengirim data, lalu lanjut sendiri begitu maintenance dimatikan. Skrip yang berjalan mengecek status tiap 5 detik, jadi perubahan mode dan teks tampil di panel dalam sekitar 5 sampai 15 detik tanpa memuat ulang skrip (skrip versi lama harus dijalankan ulang sekali).',
          'Proteksi Skrip Lua: saat nyala, /scripts/account_status.lua disajikan dalam versi ter-obfuscate dengan kunci dan nama variabel acak di setiap permintaan. Saat mati, disajikan source aslinya. Berlaku langsung di pemuatan skrip berikutnya (tanpa cache). Skrip yang sudah berjalan tidak berubah; jalankan ulang untuk mendapat versi baru.',
          'Rate Limit adalah batas request per menit di receiver. Kiriman yang memakai API Key dihitung per key, selain itu per IP. Request berlebih dijawab 429. Isi 10 sampai 100.000; nilai tersimpan saat kolom ditinggalkan.',
          'Secret Token HMAC: jika terpasang, kiriman harus membawa tanda tangan HMAC-SHA256 di header X-Webhook-Signature atau X-Hub-Signature-256. Secret disimpan terenkripsi dan tidak ditampilkan lagi. Butuh ENCRYPTION_KEY yang valid.',
        ]} />
      </section>

      {settings && (
        <div className="grid gap-4 lg:grid-cols-2">
          <RetentionPanel days={settings.data.logRetentionDays} busy={busy} onSave={(n) => void patchSettings({ logRetentionDays: n })} toast={toast} />
          <EncryptionPanel ready={settings.encryptionReady} status={settings.encryption} toast={toast} onChanged={() => void load()} />
        </div>
      )}

      {settings && (
        <div className="grid gap-4 lg:grid-cols-2">
          <NotificationsPanel toast={toast} />
          <QueuePanel toast={toast} enabled={settings.data.ingestQueueEnabled} busy={busy} onToggle={(v) => void patchSettings({ ingestQueueEnabled: v })} />
        </div>
      )}

      {settings && <ApiKeysPanel toast={toast} required={settings.data.apiKeyRequired} busy={busy} onToggleRequired={(v) => void patchSettings({ apiKeyRequired: v })} />}

      <AuditPanel toast={toast} />
    </div>
  );
}
