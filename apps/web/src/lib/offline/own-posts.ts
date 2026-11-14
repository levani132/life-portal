import type { FoodPost, PostPage, SocialProfile } from '@life-portal/shared-types';

/**
 * Which posts may be kept on the device for reading offline (spec 033, issue #20 S3, owner's
 * choice (a)): the signed-in person's own posts and nothing else. Never another person's post,
 * never a repost of one (its content is theirs), and never someone else's photos. Pure.
 *
 * Media links in a kept post are the signed ones the server sent, which expire within 2 hours;
 * offline, a photo shows only if the browser still has it. No photo is copied to the device.
 */

export const ownPost = (post: FoodPost | null | undefined): boolean => !!post && post.isOwner && !post.repost;

/** The copy of a single post to keep, or `undefined` to keep (and hold) nothing. */
export function keptOwnPost(post: FoodPost | null | undefined): FoodPost | undefined {
  return ownPost(post) ? (post as FoodPost) : undefined;
}

/** A profile page with only the person's own posts, or `undefined` when none are. */
export function keptOwnPage(page: PostPage | null | undefined): PostPage | undefined {
  const posts = (page?.posts ?? []).filter(ownPost);
  if (!posts.length) return undefined;
  // The next page is not kept, so offline there is no "Older posts" to follow.
  return { posts };
}

/**
 * The person's own profile header, so their profile (and its posts) opens offline. Identity only:
 * the shared widgets are dropped, because a widget can show money, which never stays on a device.
 */
export function keptOwnProfile(profile: SocialProfile | null | undefined): SocialProfile | undefined {
  if (!profile) return undefined;
  const { userId, username, displayName, bio, avatarUrl, relationship, muted, discoverable, friendCount } = profile;
  return {
    userId,
    username,
    displayName,
    bio,
    ...(avatarUrl ? { avatarUrl } : {}),
    relationship,
    muted,
    ...(discoverable !== undefined ? { discoverable } : {}),
    ...(friendCount !== undefined ? { friendCount } : {}),
    widgets: [],
  };
}
