import type {
  ActivityItem,
  FeatureAccess,
  FeatureId,
  NotificationEvent,
  NotificationType,
} from '@life-portal/shared-types';
import { PUSH_SERVICE_HOSTS, badgeDefinition, badgeText } from '@life-portal/shared-types';

/** The parts of stored preferences the send rules read. `undefined` = never turned on. */
export interface StoredNotificationPreferences {
  enabled?: boolean;
  types?: Partial<Record<NotificationType, boolean>>;
  showCommentPreviews?: boolean;
  showMessagePreviews?: boolean;
}

export type SkipReason =
  | 'self'
  | 'not-enabled'
  | 'type-off'
  | 'recipient-feature'
  | 'actor-feature'
  | 'blocked'
  | 'muted';

/** A missing type key reads as on (spec FR-023). */
export function typeEnabled(
  prefs: StoredNotificationPreferences | undefined,
  type: NotificationType,
): boolean {
  return prefs?.types?.[type] ?? true;
}

/**
 * Whether a notification may be sent, before collapsing. Returns why not, or `null` to send.
 * Order matters only for which reason is reported; every rule must pass.
 */
export function shouldNotify(input: {
  event: Pick<NotificationEvent, 'type' | 'recipientId' | 'actorId'>;
  prefs: StoredNotificationPreferences | undefined;
  requires: FeatureId[];
  recipientAccess: FeatureAccess;
  actorAccess: FeatureAccess;
  /** The pair's connection row, if any. */
  connection?: { blockedBy: string[]; mutedBy: string[] } | null;
  /** Only a type about the recipient's own doing (a badge) may be sent to its own actor. */
  selfAllowed?: boolean;
}): SkipReason | null {
  const { event, prefs, requires, recipientAccess, actorAccess, connection } = input;
  if (event.actorId === event.recipientId && !input.selfAllowed) return 'self';
  if (!prefs?.enabled) return 'not-enabled';
  if (!typeEnabled(prefs, event.type)) return 'type-off';
  if (!recipientAccess.push || requires.some((id) => !recipientAccess[id]))
    return 'recipient-feature';
  if (!actorAccess.social) return 'actor-feature';
  if (connection?.blockedBy.length) return 'blocked';
  if (connection?.mutedBy.includes(event.recipientId)) return 'muted';
  return null;
}

/** Sends after this instant count as "inside the window", so the next one is suppressed. */
export function collapseCutoff(now: Date, windowMs: number): Date {
  return new Date(now.getTime() - windowMs);
}

export function notificationTag(type: NotificationType, collapseKey: string): string {
  return `${type}:${collapseKey}`;
}

const TITLE_LIMIT = 60;
const PREVIEW_LIMIT = 80;

function clip(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1).trimEnd()}…` : flat;
}

function postName(title: string | undefined): string {
  const clipped = title ? clip(title, TITLE_LIMIT) : '';
  return clipped ? `“${clipped}”` : 'your post';
}

/**
 * Lock-screen text. It only ever sees names, the action, the recipient's own post title and
 * (opted in) the comment, so no tracking data can reach it (spec FR-016–FR-018).
 */
export function notificationText(
  event: Pick<
    NotificationEvent,
    'type' | 'actorName' | 'postTitle' | 'commentText' | 'messageKind' | 'messageText'
  > &
    Partial<Pick<NotificationEvent, 'targetId' | 'badgeTier' | 'count'>>,
  options: {
    showCommentPreviews: boolean;
    showMessagePreviews?: boolean;
    others?: number;
  },
): { title: string; body: string } {
  const title = clip(event.actorName, TITLE_LIMIT) || 'Someone';
  const others = options.others ?? 0;
  switch (event.type) {
    case 'friendRequest':
      return { title, body: 'sent you a friend request' };
    case 'friendAccepted':
      return { title, body: 'accepted your friend request' };
    case 'postComment': {
      const base = `commented on ${postName(event.postTitle)}`;
      const preview =
        options.showCommentPreviews && event.commentText
          ? clip(event.commentText, PREVIEW_LIMIT)
          : '';
      return { title, body: preview ? `${base}: ${preview}` : base };
    }
    case 'message': {
      const base = event.messageKind === 'post' ? 'shared a post' : 'sent you a message';
      const preview =
        options.showMessagePreviews && event.messageKind !== 'post' && event.messageText
          ? clip(event.messageText, PREVIEW_LIMIT)
          : '';
      return { title, body: preview || base };
    }
    case 'postRepost':
      return { title, body: `reposted ${postName(event.postTitle)}` };
    case 'badgeEarned':
      return badgeEarnedText(event.targetId ?? '', event.badgeTier, event.count);
    case 'postLike':
      return {
        title,
        body:
          others > 0
            ? `and ${others} ${others === 1 ? 'other' : 'others'} liked ${postName(event.postTitle)}`
            : `liked ${postName(event.postTitle)}`,
      };
  }
}

/** "You earned the 30-day logging streak", or a count when several arrived together. */
export function badgeEarnedText(
  badgeId: string,
  tier: number | undefined,
  count = 1,
): { title: string; body: string } {
  if (count > 1) return { title: 'New badges', body: `You earned ${count} badges` };
  const def = badgeDefinition(badgeId);
  const name = def ? badgeText(def.name, tier ?? def.tiers[0]) : 'a badge';
  return { title: 'New badge', body: `You earned ${name}` };
}

/** One underlying action, as an Activity source reports it. */
export interface ActivityRow {
  type: NotificationType;
  actorId: string;
  actorName: string;
  targetId: string;
  url: string;
  postTitle?: string;
  badgeId?: string;
  badgeTier?: number;
  createdAt: Date;
}

/** Types whose rows on one target merge into a single Activity item. */
const GROUPED: ReadonlySet<NotificationType> = new Set(['postLike']);
const MAX_ACTORS = 3;

/**
 * Turns rows from every source into Activity items, newest first. Likes on one post become one
 * item naming the most recent likers. `seenAt` marks which items are unseen.
 */
export function groupActivity(rows: ActivityRow[], seenAt?: Date): ActivityItem[] {
  const sorted = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const groups = new Map<string, ActivityRow[]>();
  for (const row of sorted) {
    const key = GROUPED.has(row.type)
      ? `${row.type}:${row.targetId}`
      : `${row.type}:${row.targetId}:${row.actorId}:${row.createdAt.getTime()}`;
    const group = groups.get(key);
    if (group) {
      if (!group.some((r) => r.actorId === row.actorId)) group.push(row);
    } else groups.set(key, [row]);
  }
  return [...groups.entries()].map(([id, group]) => {
    const [newest] = group;
    return {
      id,
      type: newest.type,
      actors: group
        .slice(0, MAX_ACTORS)
        .map((r) => ({ userId: r.actorId, displayName: r.actorName })),
      othersCount: Math.max(0, group.length - MAX_ACTORS),
      url: newest.url,
      ...(newest.postTitle ? { postTitle: newest.postTitle } : {}),
      ...(newest.badgeId ? { badgeId: newest.badgeId, badgeTier: newest.badgeTier } : {}),
      createdAt: newest.createdAt.toISOString(),
      unseen: !seenAt || newest.createdAt > seenAt,
    };
  });
}

/** Whether a subscription endpoint points at a known push service over HTTPS. */
export function isPushServiceEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  return (
    url.protocol === 'https:' &&
    !url.username &&
    !url.password &&
    PUSH_SERVICE_HOSTS.some((host) => host.test(url.hostname))
  );
}
