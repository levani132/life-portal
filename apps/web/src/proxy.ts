import { NextResponse, type NextRequest } from 'next/server';
import { buildCsp, cspHeaderName, originOnly } from './lib/csp';

/**
 * Issue #33: a fresh nonce and the Content-Security-Policy for every page. Next.js reads the nonce
 * from the policy on the request and puts it on its own scripts; the root layout puts it on the
 * theme script. Pages are rendered per request because of it (the layout reads `headers()`).
 */
const storageOrigin = originOnly(process.env['NEXT_PUBLIC_STORAGE_ORIGIN']);
const enforce = process.env['CSP_ENFORCE'] === 'true';
const header = cspHeaderName(enforce);

export function proxy(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const policy = buildCsp({
    nonce,
    dev: process.env.NODE_ENV === 'development',
    apiUrl: process.env['NEXT_PUBLIC_API_URL'],
    storageOrigin,
  });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set(header, policy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(header, policy);
  return response;
}

export const config = {
  matcher: [
    {
      // Pages only: not the API, built assets, icons or the service worker.
      source: '/((?!api|_next/static|_next/image|favicon.ico|icon|apple-icon|sw.js|manifest.webmanifest).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
