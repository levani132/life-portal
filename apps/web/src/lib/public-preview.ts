import type { PublicPostPreview } from '@life-portal/shared-types';

/**
 * Server-side only: the unauthenticated link preview for a public post, or null (not public,
 * gone, API asleep). Used by the post route's metadata and its Open Graph image.
 */
export async function fetchPublicPreview(id: string): Promise<PublicPostPreview | null> {
  const configured = process.env['API_INTERNAL_URL'] ?? process.env['NEXT_PUBLIC_API_URL'] ?? '';
  // A relative API URL only works in the browser; the server talks to the API directly.
  const base = /^https?:\/\//.test(configured) ? configured : 'http://127.0.0.1:3333/api';
  if (!/^[a-f0-9]{24}$/i.test(id)) return null;
  try {
    const response = await fetch(`${base}/public/posts/${id}/preview`, {
      // A free-tier API can take a while to wake; a crawler will not wait forever.
      signal: AbortSignal.timeout(8000),
      next: { revalidate: 300 },
    });
    return response.ok ? ((await response.json()) as PublicPostPreview) : null;
  } catch {
    return null;
  }
}
