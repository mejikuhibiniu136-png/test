import type { Locale } from '@/lib/i18n/config';

export interface TourStep { target: string | null; title: string; body: string }
export interface OnboardingCopy {
  badge: string; title: string; subtitle: string; enter: string; hint: string; features: string[];
  next: string; prev: string; done: string; skip: string; step: string; replay: string; tourLabel: string; steps: TourStep[];
}

const en: OnboardingCopy = {
  badge: 'Real-time webhook & log tracker', title: 'Welcome, {name}', subtitle: 'Everything your game scripts send, in one live dashboard.',
  enter: 'Enter Dashboard', hint: 'or press Enter', features: ['Live logs', 'Account status', 'Analytics'],
  next: 'Next', prev: 'Back', done: 'Done', skip: 'Skip', step: 'Step {current} of {total}', replay: 'Tutorial', tourLabel: 'Dashboard tutorial',
  steps: [
    { target: null, title: 'Quick tour', body: 'Four short steps to get you around. You can skip any time and replay it from the Tutorial button.' },
    { target: 'nav', title: 'Navigation', body: 'Switch between Overview, Logs, Game tables, Accounts and Analytics here.' },
    { target: 'status', title: 'Live connection', body: 'LIVE means data is streaming in right now. It changes if the connection drops.' },
    { target: 'controls', title: 'Controls', body: 'Choose how many logs to load, or pause the stream to inspect an entry without it moving.' },
    { target: 'content', title: 'Your data', body: 'Cards, tables and charts for the selected view appear here. Click a log row to see its full payload.' },
  ],
};

const id: OnboardingCopy = {
  badge: 'Pelacak webhook & log real-time', title: 'Selamat datang, {name}', subtitle: 'Semua data dari script game Anda, dalam satu dashboard langsung.',
  enter: 'Masuk ke Dashboard', hint: 'atau tekan Enter', features: ['Log langsung', 'Status akun', 'Analitik'],
  next: 'Lanjut', prev: 'Kembali', done: 'Selesai', skip: 'Lewati', step: 'Langkah {current} dari {total}', replay: 'Tutorial', tourLabel: 'Tutorial dashboard',
  steps: [
    { target: null, title: 'Tur singkat', body: 'Empat langkah singkat untuk mengenal dashboard. Bisa dilewati kapan saja dan diputar ulang lewat tombol Tutorial.' },
    { target: 'nav', title: 'Navigasi', body: 'Pindah antara Ringkasan, Log, Tabel Game, Akun, dan Analitik dari sini.' },
    { target: 'status', title: 'Koneksi langsung', body: 'LIVE berarti data sedang mengalir saat ini. Statusnya berubah jika koneksi terputus.' },
    { target: 'controls', title: 'Kontrol', body: 'Atur jumlah log yang dimuat, atau jeda stream agar entri yang sedang dilihat tidak bergeser.' },
    { target: 'content', title: 'Data Anda', body: 'Kartu, tabel, dan grafik untuk tampilan terpilih muncul di sini. Klik baris log untuk melihat payload lengkapnya.' },
  ],
};

// ja/zh memakai teks Inggris sampai diterjemahkan; tambahkan entri di sini untuk mengaktifkannya.
const COPY: Partial<Record<Locale, OnboardingCopy>> = { en, id };
export const getCopy = (locale: Locale): OnboardingCopy => COPY[locale] ?? en;
export const fill = (s: string, p: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(p[k] ?? ''));
