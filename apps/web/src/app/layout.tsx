import './global.css';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { AuthProvider } from '../lib/auth-context';
import { ServiceWorkerRegistration } from '../components/service-worker';

export const metadata: Metadata = {
  title: 'Life Portal',
  description: 'Debts, cash flow, assets, work, plans and food in one place.',
  applicationName: 'Life Portal',
  // Private dashboard: keep it out of search results even if the URL leaks.
  robots: { index: false, follow: false },
  icons: {
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon.ico', sizes: 'any' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180' }],
  },
  appleWebApp: {
    capable: true,
    title: 'Life Portal',
    // `black-translucent` lets the app paint under the status bar; the safe-area padding in
    // global.css is what keeps the header out from under the clock.
    statusBarStyle: 'black-translucent',
  },
  formatDetection: { telephone: false, date: false, address: false, email: false },
};

export const viewport: Viewport = {
  themeColor: '#0C0E14',
  width: 'device-width',
  initialScale: 1,
  // Deliberately not locking `maximumScale`: pinch-zoom is an accessibility feature, and the
  // layout is fluid enough not to need protecting from it.
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>{children}</AuthProvider>
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
