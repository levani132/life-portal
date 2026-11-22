/**
 * Error monitoring: the pure parts. An error record must say what broke without saying whose
 * data it broke on, so every text is scrubbed before it is stored, and a place is a pattern
 * (`/posts/:id`), never an address with someone's ids in it.
 */

export const ERROR_MESSAGE_MAX = 300;
export const ERROR_STACK_MAX = 1500;
export const ERROR_WHERE_MAX = 120;

/**
 * Removes what could identify a person or carry their data from an error's text: email
 * addresses, ids, tokens, long numbers and anything in quotes (a quoted value is usually the
 * input that failed). What is left is the shape of the error.
 */
export function scrubErrorText(text: string | undefined | null, max = ERROR_MESSAGE_MAX): string {
  return String(text ?? '')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '<email>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>')
    .replace(/\b[0-9a-f]{24}\b/gi, '<id>')
    .replace(/"[^"\n]{0,200}"/g, '"<value>"')
    .replace(/'[^'\n]{0,200}'/g, "'<value>'")
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '<token>')
    .replace(/\b\d{4,}\b/g, '<n>')
    .split('')
    // Control characters (other than a new line or a tab) become spaces.
    .map((char) => (char.charCodeAt(0) < 32 && char !== '\n' && char !== '\t' ? ' ' : char))
    .join('')
    .slice(0, max);
}

/** A stack kept for reading: scrubbed, its first lines only, and no query strings on file links. */
export function scrubStack(stack: string | undefined | null): string | undefined {
  if (!stack) return undefined;
  const lines = String(stack)
    .split('\n')
    .slice(0, 12)
    .map((line) => line.replace(/\?[^\s:)]*/g, '').trimEnd());
  return scrubErrorText(lines.join('\n'), ERROR_STACK_MAX) || undefined;
}

/** A page's path as a pattern: segments that are ids or numbers become `:id`; no query, no hash. */
export function pagePattern(path: string | undefined | null): string {
  const clean = String(path ?? '').split(/[?#]/)[0] || '/';
  const pattern = clean
    .split('/')
    .map((part) => (/^[0-9a-f]{24}$/i.test(part) || /^\d+$/.test(part) || /^[0-9a-f-]{32,}$/i.test(part) ? ':id' : part))
    .join('/');
  return scrubErrorText(pattern, ERROR_WHERE_MAX) || '/';
}

/**
 * What makes two errors the same error: where it came from, its name, its scrubbed message and
 * its place. A short stable hash, so one bug is one row however often it happens.
 */
export function errorFingerprint(input: { source: string; name: string; message: string; where: string }): string {
  const text = [input.source, input.name, input.message, input.where].join('\u0001');
  let a = 5381;
  let b = 52711;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    a = ((a * 33) ^ code) >>> 0;
    b = ((b * 33) ^ code) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

/** Whether an HTTP status is the server's fault and worth recording. A 4xx is the caller's. */
export function isServerFault(status: number | undefined): boolean {
  return status === undefined || status >= 500;
}
