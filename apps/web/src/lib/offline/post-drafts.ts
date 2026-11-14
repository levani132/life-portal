import type { Audience, PostSelection } from '@life-portal/shared-types';
import { ApiError } from '../api';

/**
 * Posts written with no connection (spec 032, issue #20 S2): kept on this device as one outbox
 * item (`social.post`) holding the photos themselves, and published when the connection is back.
 * Pure apart from what it is given, so it runs in tests unchanged.
 *
 * Photos only, already re-encoded by the composer (that is what strips GPS); a video is posted
 * only with a connection. Upload links are asked for when the draft is published, never stored:
 * they are signed for minutes.
 */

export const POST_DRAFT_KIND = 'social.post';
export const DRAFT_MAX_PHOTOS = 4;
export const DRAFT_MAX_BYTES = 50 * 1024 * 1024;

export interface DraftPhoto {
  blob: Blob;
  width: number;
  height: number;
  /** Set once this photo is uploaded, so a retry posts it instead of uploading it again. */
  mediaId?: string;
}

/** The outbox item's body: everything needed to publish, nothing derived. */
export interface PostDraftBody {
  requestId: string;
  title: string;
  caption: string;
  audience: Audience;
  source?: PostSelection;
  photos: DraftPhoto[];
}

/** What the feed and the sync sheet draw while it waits. */
export interface PostDraftMeta {
  op: 'post';
  title: string;
  caption: string;
  audience: Audience;
  photoCount: number;
  hasFood: boolean;
}

/** Why these attachments cannot be kept for later, if they cannot. */
export function draftProblem(media: readonly { kind: string; bytes: number }[]): string | undefined {
  if (media.some((item) => item.kind !== 'image')) return 'A video can only be posted with a connection.';
  if (media.length > DRAFT_MAX_PHOTOS)
    return `A post kept for later can have up to ${DRAFT_MAX_PHOTOS} photos.`;
  if (media.reduce((sum, item) => sum + item.bytes, 0) > DRAFT_MAX_BYTES)
    return 'These photos are too large to keep for later (50 MB in all).';
  return undefined;
}

export interface CreatePostBody {
  source?: PostSelection;
  previewHash?: string;
  mediaIds?: string[];
  title: string;
  caption: string;
  audience: Audience;
  requestId: string;
}

export interface PublishDeps {
  /** Asks for an upload link now and uploads the photo; resolves with its media id. */
  upload(photo: DraftPhoto, onProgress: (fraction: number) => void): Promise<string>;
  /** The food's preview as it is now: its hash freezes the numbers the post shows. */
  preview(source: PostSelection): Promise<string>;
  create(body: CreatePostBody): Promise<{ id: string }>;
  onProgress?(fraction: number): void;
}

/**
 * Publishes a draft: uploads the photos not yet uploaded (saving each id as it lands), then
 * previews the food and creates the post with the draft's `requestId`, so a repeat after a lost
 * answer returns the same post. A photo the server no longer has (`MEDIA_GONE`) is uploaded
 * again, once.
 */
export async function publishDraft(
  body: PostDraftBody,
  save: (body: PostDraftBody) => Promise<void>,
  deps: PublishDeps,
): Promise<{ id: string }> {
  let current = body;
  const attempt = async () => {
    const waiting = current.photos.filter((photo) => !photo.mediaId);
    const total = waiting.reduce((sum, photo) => sum + photo.blob.size, 0);
    let sent = 0;
    for (let index = 0; index < current.photos.length; index++) {
      const photo = current.photos[index];
      if (photo.mediaId) continue;
      const mediaId = await deps.upload(photo, (fraction) =>
        deps.onProgress?.(total ? (sent + fraction * photo.blob.size) / total : 1),
      );
      sent += photo.blob.size;
      current = {
        ...current,
        photos: current.photos.map((other, at) => (at === index ? { ...other, mediaId } : other)),
      };
      await save(current);
    }
    deps.onProgress?.(1);
    const previewHash = current.source ? await deps.preview(current.source) : undefined;
    return deps.create({
      ...(current.source ? { source: current.source, previewHash } : {}),
      ...(current.photos.length ? { mediaIds: current.photos.map((photo) => photo.mediaId as string) } : {}),
      title: current.title.trim(),
      caption: current.caption.trim(),
      audience: current.audience,
      requestId: current.requestId,
    });
  };
  try {
    return await attempt();
  } catch (error) {
    if (!(error instanceof ApiError && error.code === 'MEDIA_GONE')) throw error;
    current = { ...current, photos: current.photos.map(({ mediaId: _gone, ...photo }) => photo) };
    await save(current);
    return attempt();
  }
}

/** Post kinds whose numbers come from what was eaten (the person's own meal log). */
const LOGGED_KINDS = new Set(['entry', 'meal', 'day']);

/**
 * The waiting meal writes a draft must follow: a post of something eaten is previewed when it is
 * published, so every meal logged, corrected or removed on this device before it is sent first.
 * Weigh-ins are not food and are not waited for.
 */
export function mealWritesBefore(
  source: PostSelection | undefined,
  items: readonly { id: string; kind: string }[],
): string[] {
  if (!source || !LOGGED_KINDS.has(source.kind)) return [];
  return items
    .filter((item) => item.kind.startsWith('nutrition.entry') || item.kind.startsWith('nutrition.meal'))
    .map((item) => item.id);
}
