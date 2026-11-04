import { POST_KINDS, type PostSelection } from '@life-portal/shared-types';

/** The new post page, opened with a Food selection already attached. */
export function newPostHref(source?: PostSelection): string {
  return source ? `/new?source=${encodeURIComponent(JSON.stringify(source))}` : '/new';
}

/** Reads `?source=` back. Anything malformed is ignored: the page opens empty instead. */
export function parseNewPostSource(value: string | null): PostSelection | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as PostSelection;
    return parsed && (POST_KINDS as readonly string[]).includes(parsed.kind) ? parsed : undefined;
  } catch {
    return undefined;
  }
}
