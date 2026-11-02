/** A short opening line is a title; a longer opening line is caption-only. */
export function splitPostDraft(text: string): {
  title: string;
  caption: string;
} {
  const normalized = text.replace(/\r\n?/g, '\n');
  const [first, ...rest] = normalized.split('\n');
  return first.trim().length > 70
    ? { title: '', caption: normalized }
    : { title: first, caption: rest.join('\n') };
}
