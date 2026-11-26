import type { MealSlot, FoodUnit, ServingTotals } from './nutrition';
import type { ModuleId, Audience } from './portal';
import type { PublicPostPreview } from './posts';
export type Relationship =
  | 'self'
  | 'none'
  | 'incoming'
  | 'outgoing'
  | 'friends'
  | 'blocked';
export const CONNECTION_ACTIONS = [
  'request',
  'accept',
  'decline',
  'cancel',
  'unfriend',
  'block',
  'unblock',
  'mute',
  'unmute',
] as const;
export type ConnectionAction = (typeof CONNECTION_ACTIONS)[number];
export interface SharedStat {
  label: string;
  value: string;
  estimated?: boolean;
}
export interface SharedWidget {
  module: ModuleId;
  title: string;
  audience: Audience;
  stats: SharedStat[];
  hasDiary?: boolean;
}
export interface SocialPerson {
  userId: string;
  username: string;
  displayName: string;
  bio: string;
  /** A signed, short-lived link to the profile photo. Absent when there is none. */
  avatarUrl?: string;
  relationship: Relationship;
  muted: boolean;
  widgets?: SharedWidget[];
  /** Spec 040: a page, not a person. A page has no friends and shares no tracking. */
  isPage?: true;
  /** Spec 040: the app's own page. */
  official?: true;
  /** Spec 040: a page its manager says is run with AI. */
  aiManaged?: true;
  /** Whether the viewer follows this account: on a page for anyone, on a person only when the viewer is a page. */
  following?: boolean;
}
export interface SocialProfile extends SocialPerson {
  widgets: SharedWidget[];
  /** A page only: how many follow it, and whether the viewer does (absent on its own profile). */
  followerCount?: number;
  discoverable?: boolean;
  /** Accepted friends. Only on your own profile: other people's counts are not shown. */
  friendCount?: number;
}
/** Sets the profile photo from an upload (`POST /media`). */
export interface SocialAvatarUpdate {
  mediaId: string;
}
export interface PeoplePage {
  people: SocialPerson[];
  hasMore: boolean;
  nextSkip: number;
}
export type ConnectionList = 'friends' | 'incoming' | 'outgoing' | 'blocked';
export interface SocialProfileUpdate {
  username: string;
  displayName: string;
  bio: string;
  discoverable: boolean;
}

/** A live daily projection, with no private tracking IDs or notes. */
export interface SharedFoodDiary {
  day: string;
  today: string;
  totals: ServingTotals;
  slots: {
    slot: MealSlot;
    foods: {
      name: string;
      brand?: string;
      amount: number;
      unit: FoodUnit;
      totals: ServingTotals;
    }[];
  }[];
}

/**
 * Spec 046: a portal as someone without an account sees it. Only what the person made public,
 * and only if they can be found by strangers; a page always. Nothing else reaches a visitor.
 */
export interface PublicPortal {
  username: string;
  displayName: string;
  bio: string;
  avatarUrl?: string;
  isPage?: true;
  official?: true;
  aiManaged?: true;
  /** Modules shared with everyone, as read-only cards. */
  widgets: SharedWidget[];
  /** The two newest public posts, in the link preview's narrow form. */
  posts: PublicPostPreview[];
}
