import { createHash, randomBytes } from 'node:crypto';

/** A random URL-safe secret: 32 bytes unless said otherwise. */
export const secret = (bytes = 32) => randomBytes(bytes).toString('base64url');

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** PKCE S256 challenge for a verifier (RFC 7636). */
export const codeChallenge = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');

/**
 * Where the web app goes after Google: a path on the web app itself, nothing else. Anything that
 * could leave the site (`//host`, `/\host`, a scheme, control characters) becomes `/`.
 */
export function safeReturnTo(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 200) return '/';
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/';
  // No control characters (a header split, a hidden newline) and no backslash anywhere.
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code < 0x20 || code === 0x7f || char === '\\') return '/';
  }
  return value;
}

/** A browser's binding hash is a SHA-256 hex digest; nothing else is accepted. */
export const isBindingHash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
