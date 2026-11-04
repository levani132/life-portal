/** Direct messages between friends. See docs/modules/messages.md. */

export const MAX_MESSAGE_LENGTH = 2000;
export const MESSAGE_PAGE = 30;
/** Sends allowed per member per minute. */
export const MESSAGE_RATE_PER_MINUTE = 30;

export interface ChatPerson {
  userId: string;
  displayName: string;
  username: string;
}

/** A shared post as the viewer may see it right now, or nothing at all. */
export type SharedPostCard =
  | {
      id: string;
      title: string;
      authorName: string;
      totalKcal?: number;
      /** The post's first photo (or a video's still). A signed link, valid for an hour or more. */
      thumbnailUrl?: string;
    }
  | { unavailable: true };

export interface ChatMessage {
  id: string;
  /** Only on your own messages, so an optimistic bubble can be matched to the stored one. */
  requestId?: string;
  mine: boolean;
  kind: 'text' | 'post' | 'unsent';
  text?: string;
  post?: SharedPostCard;
  createdAt: string;
}

export type CannotSendReason = 'not-friends' | 'blocked' | 'feature';

export interface ConversationView {
  id: string;
  other: ChatPerson;
  canSend: boolean;
  cannotSendReason?: CannotSendReason;
  muted: boolean;
  /** When the other member last read the conversation. Drives "Seen". */
  otherLastReadAt?: string;
}

export interface MessagesPage {
  /** Oldest first within the page. */
  messages: ChatMessage[];
  nextBefore?: string;
}

export interface SyncResult {
  /** Messages newer than `after`, oldest first. */
  messages: ChatMessage[];
  /** Messages unsent since `since`, so older bubbles can update too. */
  unsentIds: string[];
  otherLastReadAt?: string;
  canSend: boolean;
  /** Pass back as `since` on the next sync. */
  serverTime: string;
}

export interface InboxEntry {
  id: string;
  other: ChatPerson;
  preview: string;
  lastMessageAt: string;
  /** The other member's messages since you last read, capped at 99. */
  unread: number;
}
