import { timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import type { NextFunction, Request, Response } from 'express';

/**
 * Issue #29: the web app reaches the API through its own host (`/api` on Vercel, rewritten to
 * Render), so the browser and the API are one site. Render then sees Vercel's address, not the
 * person's, and the per-IP sign-in limits would throttle everyone together.
 *
 * Vercel's rewrite adds `x-lp-proxy` with a shared secret (`vercel.json`), and Vercel itself sets
 * `x-real-ip` to the visitor's address. Only a request carrying the right secret may name its
 * client IP that way. Anything else (the Shortcut, MCP, Google's callback, anyone calling Render
 * directly) keeps the address from `trust proxy`, exactly as before, so a direct caller still
 * cannot choose its own IP.
 */
export const PROXY_HEADER = 'x-lp-proxy';

const same = (a: string, b: string) => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

/**
 * Why a request did or did not count as proxied, for `/api/health` (issue #29). It names a step,
 * never a value: a caller learns only what it sent itself, and whether the API expects a proof.
 */
export type ProxyCheck = 'ok' | 'unconfigured' | 'no-header' | 'unsubstituted' | 'mismatch' | 'no-ip';

export function checkProxy(headers: Request['headers'], secret: string | undefined): { check: ProxyCheck; ip?: string } {
  if (!secret) return { check: 'unconfigured' };
  const proof = headers[PROXY_HEADER];
  if (typeof proof !== 'string' || proof === '') return { check: 'no-header' };
  // Vercel sends a variable it does not have as its literal name.
  if (proof.startsWith('$')) return { check: 'unsubstituted' };
  if (!same(proof, secret)) return { check: 'mismatch' };
  const real = headers['x-real-ip'];
  const ip = typeof real === 'string' ? real.trim() : '';
  return isIP(ip) ? { check: 'ok', ip } : { check: 'no-ip' };
}

/** The visitor's address when the request provably came through the web app's proxy. */
export function proxiedClientIp(headers: Request['headers'], secret: string | undefined): string | undefined {
  return checkProxy(headers, secret).ip;
}

/** Marks a request that came through the web app's proxy. */
export interface ProxiedRequest extends Request {
  viaWebProxy?: boolean;
  proxyCheck?: ProxyCheck;
}

export function webProxyMiddleware(secret: string | undefined) {
  return (req: ProxiedRequest, _res: Response, next: NextFunction) => {
    const { check, ip } = checkProxy(req.headers, secret);
    req.proxyCheck = check;
    // The secret is never visible past this point, whatever it held.
    delete req.headers[PROXY_HEADER];
    if (ip) {
      Object.defineProperty(req, 'ip', { value: ip, configurable: true, enumerable: true });
      req.viaWebProxy = true;
    }
    next();
  };
}
