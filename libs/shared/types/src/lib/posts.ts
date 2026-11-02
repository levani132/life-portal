import type { Audience } from './portal';
import type { FoodUnit, MealSlot, NutritionFacts } from './nutrition';
export const POST_KINDS = [
  'entry',
  'meal',
  'day',
  'food',
  'combination',
  'database',
] as const;
export type FoodPostKind = (typeof POST_KINDS)[number];
export const MAX_POST_ITEMS = 1000;
export interface PostSelection {
  kind: FoodPostKind;
  entryId?: string;
  day?: string;
  slot?: MealSlot;
  foodId?: string;
  savedMealId?: string;
  components?: { foodId: string; amount: number }[];
}
export interface FoodAttribution {
  label: string;
  url?: string;
}
/** Published nutrition facts only: no private source IDs, notes or measurements. */
export interface PublishedFood extends NutritionFacts {
  key: string;
  name: string;
  brand?: string;
  unit: FoodUnit;
  servingSize: number;
  servingLabel?: string;
  amount?: number;
  slot?: MealSlot;
  attribution?: FoodAttribution;
}
export interface PublishedMacros {
  energyKcal: number;
  proteinG: number;
  carbG: number;
  fatG: number;
}
export interface FoodPublication {
  /** Frozen daily targets, explicitly included in the sharing preview. */
  targets?: Partial<PublishedMacros>;
  kind: FoodPostKind;
  label: string;
  day?: string;
  slot?: MealSlot;
  items: PublishedFood[];
}
export interface PostPreview {
  publication: FoodPublication;
  previewHash: string;
}
export interface PostAuthor {
  userId: string;
  displayName: string;
  username: string;
}
export interface FoodPost {
  id: string;
  author: PostAuthor;
  contentLabel?: string;
  title: string;
  caption: string;
  audience: Audience;
  kind: FoodPostKind;
  day?: string;
  slot?: MealSlot;
  createdAt: string;
  updatedAt: string;
  version: 1;
  itemCount: number;
  /** Feed cards contain only a teaser; detail includes the full publication. */
  items: PublishedFood[];
  totalKcal?: number;
  totalMacros?: PublishedMacros;
  targets?: Partial<PublishedMacros>;
  isOwner: boolean;
}
export interface PostPage {
  posts: FoodPost[];
  nextCursor?: string;
}
export interface PostImportItem {
  key: string;
  alreadyImported: boolean;
  duplicateName?: string;
}
export interface PostImportPreview {
  items: PostImportItem[];
  canSaveMeal: boolean;
}
export interface PostImportResult {
  createdCount: number;
  reusedCount: number;
  skippedCount: number;
  savedMealId?: string;
}
export const REPORT_REASONS = [
  'spam',
  'harassment',
  'privacy',
  'misleading',
  'other',
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export interface PostReport {
  id: string;
  postId: string;
  reporterId: string;
  reason: ReportReason;
  createdAt: string;
}

export interface PostEngagement {
  liked: boolean;
  likeCount: number;
  commentCount: number;
}
export interface PostComment {
  id: string;
  author: PostAuthor;
  text: string;
  createdAt: string;
  canDelete: boolean;
}
export interface PostCommentsPage {
  comments: PostComment[];
  nextCursor?: string;
}
