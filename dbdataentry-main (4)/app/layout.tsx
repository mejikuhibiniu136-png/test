import type { Metadata, Viewport } from 'next';
import './globals.css';
import { I18nProvider } from '@/components/i18n/I18nProvider';
import { MotionProvider } from '@/components/ui/MotionProvider';
import { getDictionary, getLocale } from '@/lib/i18n/server';

export const metadata: Metadata = {
  title: 'dbdataentry · Webhook & Log Tracker',
  description: 'Real-time dashboard for universal webhooks and account status.',
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { themeColor: '#070a12', colorScheme: 'dark' };

// Bahasa ditentukan di server (cookie > Accept-Language > en) sehingga HTML pertama sudah benar,
// tanpa kedip. Hanya kamus bahasa aktif yang dikirim ke klien.
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [locale, dictionary] = await Promise.all([getLocale(), getDictionary()]);
  return (
    <html lang={locale}>
      <body><I18nProvider locale={locale} dictionary={dictionary}><MotionProvider>{children}</MotionProvider></I18nProvider></body>
    </html>
  );
}
