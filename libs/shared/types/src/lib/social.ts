import type { MealSlot, FoodUnit, ServingTotals } from './nutrition';
import type { ModuleId, Audience } from './portal';
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
  relationship: Relationship;
  muted: boolean;
  widgets?: SharedWidget[];
}
export interface SocialProfile extends SocialPerson {
  widgets: SharedWidget[];
  discoverable?: boolean;
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
