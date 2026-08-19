import type { MetadataRoute } from 'next';

/**
 * Web app manifest. Next serves this at `/manifest.webmanifest` and links it automatically.
 *
 * `display: 'standalone'` is the point of the exercise: this is a dashboard the owner opens several
 * times a day from a phone home screen, and the browser chrome is wasted vertical space.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Life Portal',
    short_name: 'Life Portal',
    description: 'Debts, cash flow, assets, work, plans and food in one place.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    // Matches `--surface` in global.css, so the splash screen and the app agree.
    background_color: '#0C0E14',
    theme_color: '#0C0E14',
    lang: 'en',
    dir: 'ltr',
    categories: ['finance', 'productivity', 'health'],
    icons: [
      { src: '/icon.svg', type: 'image/svg+xml', sizes: 'any' },
      { src: '/icon-192.png', type: 'image/png', sizes: '192x192', purpose: 'any' },
      { src: '/icon-512.png', type: 'image/png', sizes: '512x512', purpose: 'any' },
      // Maskable icons are a separate file: Android crops to its own shape, and the "any" icon's
      // rounded corners would be clipped into something lopsided.
      { src: '/icon-maskable-192.png', type: 'image/png', sizes: '192x192', purpose: 'maskable' },
      { src: '/icon-maskable-512.png', type: 'image/png', sizes: '512x512', purpose: 'maskable' },
    ],
  };
}
