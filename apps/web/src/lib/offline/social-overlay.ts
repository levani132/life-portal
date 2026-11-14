import type { PostAuthor, PostComment, PostEngagement } from '@life-portal/shared-types';

/**
 * Likes, reposts and comments made with no connection (spec 031, issue #20 S1), as the post shows
 * them: the server's last answer with this device's waiting writes applied. Pure. A waiting
 * change is marked `unsent` and is never presented as seen by anyone else: the server notifies
 * the author only when it accepts the write.
 */

export type SocialWriteMeta =
  | { op: 'like'; postId: string; on: boolean }
  | { op: 'repost'; postId: string; on: boolean }
  | { op: 'comment'; postId: string; commentId: string; text: string; createdAt: string }
  | { op: 'comment.remove'; postId: string; commentId: string };

export interface SocialWrite {
  meta: SocialWriteMeta;
  /** Acknowledged by the server, waiting only for the refetch. */
  settled?: boolean;
}

export function socialMetaOf(meta: unknown): SocialWriteMeta | undefined {
  const value = meta as Partial<SocialWriteMeta> | undefined;
  return value && typeof value === 'object' && typeof value.op === 'string' && typeof value.postId === 'string'
    ? (value as SocialWriteMeta)
    : undefined;
}

export type ShownEngagement = PostEngagement & { unsent?: boolean };

/** One flag (liked or reposted) after the writes: the last one wins, and the count follows it. */
function toggle(base: boolean, count: number, writes: SocialWrite[]): { on: boolean; count: number } {
  const last = writes[writes.length - 1];
  if (!last || !('on' in last.meta)) return { on: base, count };
  const on = last.meta.on;
  return { on, count: on === base ? count : Math.max(0, count + (on ? 1 : -1)) };
}

export function overlayEngagement(base: PostEngagement, postId: string, writes: readonly SocialWrite[]): ShownEngagement {
  const mine = writes.filter((write) => write.meta.postId === postId);
  if (!mine.length) return base;
  // Acknowledged writes are already in a refetched `base`; only waiting ones move the figures.
  const waiting = mine.filter((write) => !write.settled);
  const like = toggle(base.liked, base.likeCount, waiting.filter((write) => write.meta.op === 'like'));
  const repost = toggle(base.reposted, base.repostCount, waiting.filter((write) => write.meta.op === 'repost'));
  const added = waiting.filter((write) => write.meta.op === 'comment').length;
  const removed = waiting.filter((write) => write.meta.op === 'comment.remove').length;
  return {
    ...base,
    liked: like.on,
    likeCount: like.count,
    reposted: repost.on,
    repostCount: repost.count,
    commentCount: Math.max(0, base.commentCount + added - removed),
    ...(waiting.length ? { unsent: true } : {}),
  };
}

export type ShownComment = PostComment & { unsent?: boolean };

/** The comments as shown: the server's, with this device's waiting ones added and removals applied. */
export function overlayComments(
  base: readonly PostComment[],
  postId: string,
  writes: readonly SocialWrite[],
  me: PostAuthor,
): ShownComment[] {
  const rows = new Map<string, ShownComment>(base.map((comment) => [comment.id, comment]));
  for (const { meta, settled } of writes) {
    if (meta.postId !== postId) continue;
    if (meta.op === 'comment' && !rows.has(meta.commentId)) {
      rows.set(meta.commentId, {
        id: meta.commentId,
        author: me,
        text: meta.text,
        createdAt: meta.createdAt,
        canDelete: true,
        ...(settled ? {} : { unsent: true }),
      });
    }
    if (meta.op === 'comment.remove') rows.delete(meta.commentId);
  }
  return [...rows.values()];
}

/**
 * Which waiting writes a new like (or repost) toggle cancels instead of adding to: the opposite one
 * still waiting for the same post. Liking and unliking with no connection then sends nothing.
 * Only a write that never left the device: one that may have reached the server (its answer
 * lost) is not withdrawn, or the server's state could end up the opposite of the screen's.
 */
export function cancelledBy(
  items: readonly { id: string; meta?: unknown; state: string; maybeSent?: boolean }[],
  next: Extract<SocialWriteMeta, { op: 'like' | 'repost' }>,
): string[] {
  return items
    .filter((item) => {
      const meta = socialMetaOf(item.meta);
      return item.state === 'pending' && !item.maybeSent && meta?.op === next.op && meta.postId === next.postId && meta.on !== next.on;
    })
    .map((item) => item.id);
}
