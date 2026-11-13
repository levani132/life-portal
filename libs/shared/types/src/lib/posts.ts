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
  /** A signed, short-lived link to the author's profile photo. */
  avatarUrl?: string;
}
/** Diet topics a post can carry (issue #8). Computed from published facts, never stored. */
export const DIET_TOPICS = [
  'high-protein',
  'low-carb',
  'low-fat',
  'low-calorie',
  'low-sugar',
  'high-fibre',
] as const;
export type DietTopic = (typeof DIET_TOPICS)[number];
/**
 * An explainable topic of a post, computed on read from what it publishes (`postTopics` in the
 * domain lib): `diet:<DietTopic>` from its food facts, or `tag:<name>` from a caption hashtag.
 * The id is stable, so ranking and interests can refer to it; `basis` says why it applies.
 */
export interface PostTopic {
  id: string;
  kind: 'diet' | 'hashtag';
  label: string;
  basis: string;
}
export interface FoodPost {
  id: string;
  author: PostAuthor;
  contentLabel?: string;
  title: string;
  caption: string;
  audience: Audience;
  /** Absent for a post without food (text and/or media only). */
  kind?: FoodPostKind;
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
  /** Photos and videos, in order. Links are signed per read and expire within 2 hours. */
  media: PostMedia[];
  /** Diet tags and caption hashtags, computed on read from the whole publication (issue #8). */
  topics: PostTopic[];
  isOwner: boolean;
  /**
   * Set when this card is someone's repost: the post itself is always the original (its id,
   * author and content), so likes, comments and shares go to the original.
   */
  repost?: PostRepost;
}
export interface PostRepost {
  /** The repost row's id. Unique per card in a feed; never addressable as a post. */
  id: string;
  by: PostAuthor;
  /** The viewer is the one who reposted. */
  isMine: boolean;
  createdAt: string;
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
  /** Whether the viewer has reposted this post, and how many members have. */
  reposted: boolean;
  repostCount: number;
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

// ------------------------------------------------------------------ media (spec 014)

export const MEDIA_KINDS = ['image', 'video'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];
export const MAX_POST_MEDIA = 10;
export const MAX_VIDEO_SECONDS = 30;
/** Accepted types and sizes, checked when an upload is requested and again on attach. */
export const MEDIA_LIMITS = {
  image: { maxBytes: 15 * 1024 * 1024, types: ['image/jpeg'] },
  video: {
    maxBytes: 60 * 1024 * 1024,
    types: ['video/mp4', 'video/webm', 'video/quicktime'],
  },
  poster: { maxBytes: 2 * 1024 * 1024, types: ['image/jpeg'] },
} as const;
/** The longest edge a photo is resized to on the device. */
export const MAX_IMAGE_EDGE = 2048;

export interface PostMedia {
  id: string;
  kind: MediaKind;
  width: number;
  height: number;
  durationMs?: number;
  url: string;
  /** A still for a video, shown before it loads. */
  posterUrl?: string;
}
export interface MediaConfig {
  available: boolean;
  maxItems: number;
  maxVideoSeconds: number;
}
export interface MediaUploadRequest {
  kind: MediaKind;
  contentType: string;
  bytes: number;
  width: number;
  height: number;
  durationMs?: number;
  poster?: { bytes: number };
}
export interface SignedUpload {
  url: string;
  headers: Record<string, string>;
}
export interface MediaUploadTicket {
  id: string;
  upload: SignedUpload;
  poster?: SignedUpload;
}

/**
 * What an unauthenticated link preview may show about a post (spec 017): only for a live, public
 * post whose author still posts. Everything else answers 404 with no reason.
 */
export interface PublicPostPreview {
  id: string;
  title: string;
  /** At most 200 characters of the caption. */
  caption: string;
  authorName: string;
  /** "Food", "Meal"…; absent for a post without food. */
  label?: string;
  macros?: PublishedMacros;
  /** A signed link to the first photo (or a video's still), valid for under two hours. */
  photoUrl?: string;
}
