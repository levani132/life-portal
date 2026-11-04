import {
  MAX_POST_MEDIA,
  MAX_VIDEO_SECONDS,
  MEDIA_LIMITS,
  type MediaUploadRequest,
} from '@life-portal/shared-types';

/** A post needs at least one of: text, media, a food attachment (spec FR-002). */
export function postHasContent(post: {
  title?: string;
  caption?: string;
  mediaCount?: number;
  hasFood?: boolean;
}): boolean {
  return (
    !!post.title?.trim() ||
    !!post.caption?.trim() ||
    (post.mediaCount ?? 0) > 0 ||
    !!post.hasFood
  );
}

/** Why an upload request is refused, or null when it is acceptable. */
export function mediaLimitError(request: MediaUploadRequest): string | null {
  const limits = MEDIA_LIMITS[request.kind];
  if (!limits) return 'Only photos and videos can be added.';
  if (!(limits.types as readonly string[]).includes(request.contentType))
    return request.kind === 'image'
      ? 'Photos must be JPEG.'
      : 'Videos must be MP4, WebM or QuickTime.';
  if (!Number.isInteger(request.bytes) || request.bytes < 1)
    return 'The file is empty.';
  if (request.bytes > limits.maxBytes)
    return `This ${request.kind === 'image' ? 'photo' : 'video'} is too large.`;
  if (
    !Number.isInteger(request.width) ||
    !Number.isInteger(request.height) ||
    request.width < 1 ||
    request.height < 1 ||
    request.width > 8192 ||
    request.height > 8192
  )
    return 'The size of this file could not be read.';
  if (request.kind === 'video') {
    // Half a second of grace: a recorder stopped at 30 s writes a few frames past it.
    if (
      request.durationMs === undefined ||
      request.durationMs < 1 ||
      request.durationMs > MAX_VIDEO_SECONDS * 1000 + 500
    )
      return `Videos can be at most ${MAX_VIDEO_SECONDS} seconds.`;
    if (!request.poster) return 'A video needs a still.';
    if (request.poster.bytes < 1 || request.poster.bytes > MEDIA_LIMITS.poster.maxBytes)
      return 'The video still is too large.';
  } else if (request.durationMs !== undefined || request.poster)
    return 'Photos have no duration or still.';
  return null;
}

/** Whether a list of media ids can go on one post. */
export function mediaListError(ids: string[]): string | null {
  if (ids.length > MAX_POST_MEDIA)
    return `A post can have at most ${MAX_POST_MEDIA} photos and videos.`;
  if (new Set(ids).size !== ids.length) return 'The same photo was added twice.';
  return null;
}

/**
 * The display ratio (width ÷ height) for a carousel, from its first item, clamped the way
 * Instagram does: no taller than 4:5, no wider than 1.91:1.
 */
export function clampAspect(width: number, height: number): number {
  if (!(width > 0) || !(height > 0)) return 1;
  return Math.min(1.91, Math.max(0.8, width / height));
}

/** Fits a picture inside a square of `maxEdge`, keeping its ratio. Never enlarges. */
export function fitWithin(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Each macro's share of a food's calories (protein and carbs 4 kcal/g, fat 9). The shares add
 * up to 1 (or are all 0 when there are no macros), so they can draw a split ring without any
 * daily target.
 */
export function macroShares(macros: {
  proteinMg: number;
  carbMg: number;
  fatMg: number;
}): { protein: number; carbs: number; fat: number } {
  const protein = Math.max(0, macros.proteinMg) * 0.004;
  const carbs = Math.max(0, macros.carbMg) * 0.004;
  const fat = Math.max(0, macros.fatMg) * 0.009;
  const total = protein + carbs + fat;
  if (!(total > 0)) return { protein: 0, carbs: 0, fat: 0 };
  return { protein: protein / total, carbs: carbs / total, fat: fat / total };
}

/**
 * What the new-food buttons say and do. Logging needs a saved food, so it is ignored (and its
 * checkbox disabled) while saving is off.
 */
export function newFoodActions(options: { save: boolean; log: boolean }): {
  canLog: boolean;
  log: boolean;
  /** Saves (and logs) without posting. Absent when nothing would be kept. */
  keep?: string;
  post: string;
} {
  if (!options.save) return { canLog: false, log: false, post: 'Post' };
  return options.log
    ? { canLog: true, log: true, keep: 'Save and log food', post: 'Save, Log and Post' }
    : { canLog: true, log: false, keep: 'Save food', post: 'Save and Post' };
}
