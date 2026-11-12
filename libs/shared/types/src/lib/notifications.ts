/**
 * Push notifications and Activity. One shared system: a module that wants to notify adds its
 * type here and registers a definition with the API's NotificationsService. See
 * docs/modules/notifications.md.
 */
export const NOTIFICATION_TYPES = [
  'friendRequest',
  'friendAccepted',
  'postComment',
  'postLike',
  'postRepost',
  'message',
  'badgeEarned',
  'restOver',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/**
 * What a sending module hands to `notify()`. It carries only data the sender already loaded,
 * so the notifications module never reads another module's collections.
 */
export interface NotificationEvent {
  type: NotificationType;
  recipientId: string;
  actorId: string;
  actorName: string;
  /** The thing the notification is about: a post ID, or the actor for friend events. */
  targetId: string;
  /** The recipient's own post title. Never another member's private text. */
  postTitle?: string;
  /** Shown only when the recipient enabled comment previews. */
  commentText?: string;
  /** For `message`: what was sent, and its text (shown only with message previews on). */
  messageKind?: 'text' | 'post';
  messageText?: string;
  /** For `badgeEarned` (targetId is the badge id): its tier, and how many awards arrived together. */
  badgeTier?: number;
  count?: number;
}

/** The encrypted push message body. Only the service worker reads it. */
export interface PushPayload {
  title: string;
  body: string;
  /** Same-origin path inside the app. */
  url: string;
  /** Collapse key on the device: a newer notification with the same tag replaces the older. */
  tag: string;
  /** Unseen count for the app icon. */
  badge?: number;
}

export interface ActivityActor {
  userId: string;
  displayName: string;
}

export interface ActivityItem {
  /** Stable for the same underlying rows, e.g. `postLike:<postId>`. */
  id: string;
  type: NotificationType;
  /** Most recent first. Likes on one post are grouped. */
  actors: ActivityActor[];
  /** Actors beyond `actors` in a grouped item. */
  othersCount: number;
  url: string;
  postTitle?: string;
  /** For `badgeEarned`: which badge, at which tier. */
  badgeId?: string;
  badgeTier?: number;
  /** ISO time of the newest underlying action. */
  createdAt: string;
  unseen: boolean;
}

export interface ActivityPage {
  items: ActivityItem[];
  nextBefore?: string;
}

export interface NotificationPreferences {
  enabled: boolean;
  /** Always complete in responses. A key the member never touched reads as on. */
  types: Record<NotificationType, boolean>;
  showCommentPreviews: boolean;
  showMessagePreviews: boolean;
  /** Set when the in-app offer is hidden; the offer may show again after this time. */
  offerHiddenUntil?: string;
}

export interface PushDeviceSummary {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string;
}

export interface NotificationsConfig {
  available: boolean;
  publicKey?: string;
}

/** Push service hosts a subscription endpoint may point at. Anything else is refused. */
export const PUSH_SERVICE_HOSTS = [
  /(^|\.)push\.apple\.com$/,
  /^fcm\.googleapis\.com$/,
  /^android\.googleapis\.com$/,
  /(^|\.)notify\.windows\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
] as const;
