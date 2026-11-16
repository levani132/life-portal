/**
 * Issue #33: the web app's Content-Security-Policy. Pure, so the proxy and the tests build the
 * same policy.
 *
 * - **Scripts: a per-request nonce with `'strict-dynamic'`.** Next.js puts each page's data in
 *   inline scripts that differ per page and per build, so no fixed list of hashes can allow them
 *   (the experimental SRI option was tried in a production build and left them uncovered). A
 *   nonce means every page renders on request; see `docs/DECISIONS.md`.
 * - **`'unsafe-eval'` only in development**, where React needs it; never in production.
 * - **Network:** this origin, the API's origin when it is another site (before #29's switch),
 *   and the storage origin for photo uploads and signed reads.
 * - **Styles allow inline**: React `style={{…}}` attributes and Next's style tags need it, and
 *   styles cannot run code.
 */
export interface CspInput {
  nonce: string;
  dev: boolean;
  /** `NEXT_PUBLIC_API_URL`: relative (this origin) or absolute (another site). */
  apiUrl: string | undefined;
  /** `NEXT_PUBLIC_STORAGE_ORIGIN`, already validated by `originOnly`. */
  storageOrigin: string | undefined;
}

/**
 * `value` as a bare origin (`https://host[:port]`), or undefined when it is anything else: a path,
 * a query, credentials, another scheme. A malformed value must not widen the policy.
 */
export function originOnly(value: string | undefined): string | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return undefined;
  if (url.username || url.password || url.search || url.hash) return undefined;
  if (url.pathname !== '/' && url.pathname !== '') return undefined;
  // One exact host: no wildcard, nothing a policy would read as another source.
  if (!/^[a-z0-9.-]+$/.test(url.hostname)) return undefined;
  if (raw.replace(/\/$/, '') !== url.origin) return undefined;
  return url.origin;
}

/** The API's origin when it is not this one. */
function apiOrigin(apiUrl: string | undefined): string | undefined {
  if (!apiUrl || apiUrl.startsWith('/')) return undefined;
  try {
    return new URL(apiUrl).origin;
  } catch {
    return undefined;
  }
}

export function buildCsp({ nonce, dev, apiUrl, storageOrigin }: CspInput): string {
  const extra = (...values: (string | undefined)[]) => values.filter(Boolean).join(' ');
  const api = apiOrigin(apiUrl);
  const directives: [string, string][] = [
    ['default-src', "'self'"],
    ['script-src', extra("'self'", `'nonce-${nonce}'`, "'strict-dynamic'", dev ? "'unsafe-eval'" : undefined)],
    ['style-src', "'self' 'unsafe-inline'"],
    ['img-src', extra("'self'", 'data:', 'blob:', storageOrigin)],
    ['media-src', extra("'self'", 'blob:', storageOrigin)],
    ['font-src', "'self' data:"],
    // Development: the dev server's hot reload socket.
    ['connect-src', extra("'self'", api, storageOrigin, dev ? 'ws:' : undefined)],
    ['worker-src', "'self'"],
    ['manifest-src', "'self'"],
    ['object-src', "'none'"],
    ['base-uri', "'self'"],
    ['frame-ancestors', "'none'"],
    ['form-action', "'self'"],
  ];
  return directives.map(([name, value]) => `${name} ${value}`).join('; ');
}

/** Report-only until `CSP_ENFORCE=true` (issue #33: verify on real devices first). */
export const cspHeaderName = (enforce: boolean) =>
  enforce ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only';
