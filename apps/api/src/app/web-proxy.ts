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

/** The visitor's address when the request provably came through the web app's proxy. */
export function proxiedClientIp(headers: Request['headers'], secret: string | undefined): string | undefined {
  if (!secret) return undefined;
  const proof = headers[PROXY_HEADER];
  if (typeof proof !== 'string' || !same(proof, secret)) return undefined;
  const real = headers['x-real-ip'];
  const ip = typeof real === 'string' ? real.trim() : '';
  return isIP(ip) ? ip : undefined;
}

/** Marks a request that came through the web app's proxy. */
export interface ProxiedRequest extends Request {
  viaWebProxy?: boolean;
}

export function webProxyMiddleware(secret: string | undefined) {
  return (req: ProxiedRequest, _res: Response, next: NextFunction) => {
    const ip = proxiedClientIp(req.headers, secret);
    // The secret is never visible past this point, whatever it held.
    delete req.headers[PROXY_HEADER];
    if (ip) {
      Object.defineProperty(req, 'ip', { value: ip, configurable: true, enumerable: true });
      req.viaWebProxy = true;
    }
    next();
  };
}
