import type { Audience } from './portal';
import type { FoodUnit, MealSlot, NutritionFacts } from './nutrition';
import type { TrainingAttachment } from './training-posts';
export const POST_KINDS = [
  'entry',
  'meal',
  'day',
  'food',
  'combination',
  'database',
  'mealPlan',
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
  /** Spec 042: a meal plan of the author's. */
  mealPlanId?: string;
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
  /** Spec 042, in a published meal plan: which day (an index into `days`), and the recipe this food came from. */
  dayIndex?: number;
  /** Spec 042, in a published meal plan: every meal the line may be eaten at, when more than one. */
  slots?: MealSlot[];
  group?: string;
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
  /** Spec 042, a meal plan: its days' names, in order. Items point at them with `dayIndex`. */
  days?: string[];
  /**
   * Spec 042: a published recipe's own words. A recipe may be published with these and no foods:
   * its author gave no nutrition numbers, and the post says so.
   */
  recipe?: PublishedRecipe;
}
export interface PublishedRecipe {
  ingredients: string[];
  steps: string[];
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
  /** Spec 040: the author is a page, not a person. Shown beside the name wherever it appears. */
  isPage?: true;
  /** Spec 040: the app's own page. */
  official?: true;
  /** Spec 040: a page its manager says is run with AI. */
  aiManaged?: true;
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
/**
 * Why For You ranked a post where it is (#9). Only ever true statements about the viewer's own
 * likes, comments and reposts, their chosen interests, or the post itself. Absent in the
 * chronological fallback.
 */
export const FOR_YOU_REASON_CODES = ['interest', 'topic', 'author', 'popular', 'explore', 'fresh'] as const;
export type ForYouReasonCode = (typeof FOR_YOU_REASON_CODES)[number];
export interface ForYouReason {
  code: ForYouReasonCode;
  /** The post topic the reason is about, for `interest` and `topic`. */
  topicId?: string;
  /** Ready to show, e.g. "Because you engaged with posts tagged High protein". */
  text: string;
}
export interface FoodPost {
  id: string;
  author: PostAuthor;
  contentLabel?: string;
  title: string;
  caption: string;
  audience: Audience;
  /**
   * A link-only post: private (on no wall, in no feed), but open to the people it was sent to
   * in a message and to anyone who opens its link, which carries `shareKey`.
   */
  linkOnly?: boolean;
  /** The secret part of a link-only post's link (`/posts/<id>?k=<shareKey>`). */
  shareKey?: string;
  /**
   * Only ever sent to the author: nobody else can see the post for now. `checking`: its photos
   * are being checked, usually for a few seconds. `review`: it is waiting for a person.
   */
  held?: 'checking' | 'review';
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
  /** Spec 042: the recipe's written ingredients and method, when the post carries a recipe. */
  recipe?: PublishedRecipe;
  /** Spec 042: a meal plan's day names. */
  days?: string[];
  totalKcal?: number;
  totalMacros?: PublishedMacros;
  targets?: Partial<PublishedMacros>;
  /** Photos and videos, in order. Links are signed per read and expire within 2 hours. */
  media: PostMedia[];
  /** Diet tags and caption hashtags, computed on read from the whole publication (issue #8). */
  topics: PostTopic[];
  /** For You with personalised ranking only: up to two reasons this post is here. */
  reasons?: ForYouReason[];
  isOwner: boolean;
  /** Spec 036: the post's Training attachment, when it has one. Independent of the food fields. */
  training?: TrainingAttachment;
  /** Spec 036: the author's choice, shown to them on their own post. */
  allowCopy?: boolean;
  /** Spec 036: whether this viewer may copy the Training attachment into their own data. */
  canCopy?: boolean;
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
  /** A ranked For You cursor whose session has expired: start again from the top. */
  expired?: boolean;
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
  /** Spec 042: the reader's own copy of a published meal plan. */
  mealPlanId?: string;
}
export const REPORT_REASONS = [
  'nudity',
  'violence',
  'child_safety',
  'spam',
  'harassment',
  'privacy',
  'misleading',
  'other',
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
/** What the report dialog and the review queue call each reason. */
export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  nudity: 'Nudity or sexual content',
  violence: 'Violence or gore',
  child_safety: 'Something that puts a child at risk',
  spam: 'Spam',
  harassment: 'Harassment or hate',
  privacy: 'Shows someone’s private information',
  misleading: 'Misleading or dangerous advice',
  other: 'Something else',
};

/**
 * Why a post is hidden from everyone but its author (spec 039):
 * `checking` while its photos wait for the automatic check, `check` when that check flagged
 * them, `reports` when enough people reported it. A reviewer keeps or removes it.
 */
export const POST_HOLD_REASONS = ['checking', 'check', 'reports'] as const;
export type PostHoldReason = (typeof POST_HOLD_REASONS)[number];

/** One post waiting for the reviewer (developer only). */
export interface ModerationItem {
  postId: string;
  author: { id: string; displayName: string; username?: string; suspended: boolean };
  title: string;
  caption: string;
  audience: Audience;
  linkOnly: boolean;
  createdAt: string;
  /** Signed for this read, like any post's. */
  media: PostMedia[];
  /** What the post's food or training attachment is called, if it has one. */
  attachment?: string;
  held?: PostHoldReason;
  heldAt?: string;
  /** What the automatic check named, when it flagged the post. */
  checkCategories?: string[];
  reports: { reason: ReportReason; count: number }[];
  reportCount: number;
}
/** One automatic photo check, as numbers only (developer only): no post, no person. */
export interface ModerationCheck {
  checkedAt: string;
  result: 'ok' | 'flagged';
  /** Whether the checked post is the developer's own. */
  mine: boolean;
  /** The highest-scoring categories, 0 to 1. */
  scores: { category: string; score: number }[];
}
export interface ModerationQueue {
  items: ModerationItem[];
  /** Whether photos are checked automatically on this server. */
  imageCheck: boolean;
}
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
  /** A reply: the top-level comment it answers. Replies are one level deep. */
  parentId?: string;
  /** On a top-level comment in a list: how many replies it has, and its newest ones (oldest first). */
  replyCount?: number;
  replies?: PostComment[];
}
/** How many comments and replies a list shows first, and how many each "show earlier" adds. */
export const COMMENTS_FIRST = 3;
export const COMMENTS_MORE = 10;
export const REPLIES_FIRST = 1;
export const REPLIES_MORE = 5;
export const COMMENTS_PAGE_MAX = 20;
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

// ------------------------------------------------------------------ For You interests (#10)

/** Bumped when interests are added, renamed or retired; stored ids never change meaning. */
export const FOR_YOU_INTERESTS_VERSION = 1;
export const MAX_FOR_YOU_INTERESTS = 20;

/**
 * A broad interest someone can choose for For You (#10). It matches posts through their computed
 * topics (#8): a diet tag, or caption hashtags. Choosing one never hides anything; it only lifts
 * matching posts when personalised ranking (#9) is on.
 */
export interface ForYouInterest {
  id: string;
  label: string;
  group: 'diet' | 'general';
  /** Post topic ids (`diet:*`, `tag:*`) this interest matches. */
  topicIds: readonly string[];
}

const tags = (...names: string[]) => names.map((name) => `tag:${name}`);

export const FOR_YOU_INTERESTS: readonly ForYouInterest[] = [
  { id: 'high-protein', label: 'High protein', group: 'diet', topicIds: ['diet:high-protein'] },
  { id: 'low-carb', label: 'Low carb', group: 'diet', topicIds: ['diet:low-carb'] },
  { id: 'low-fat', label: 'Low fat', group: 'diet', topicIds: ['diet:low-fat'] },
  { id: 'low-calorie', label: 'Low calorie', group: 'diet', topicIds: ['diet:low-calorie'] },
  { id: 'low-sugar', label: 'Low sugar', group: 'diet', topicIds: ['diet:low-sugar'] },
  { id: 'high-fibre', label: 'High fibre', group: 'diet', topicIds: ['diet:high-fibre'] },
  { id: 'home-cooking', label: 'Home cooking', group: 'general', topicIds: tags('homecooking', 'homemade', 'cooking') },
  { id: 'quick-meals', label: 'Quick meals', group: 'general', topicIds: tags('quickmeals', 'easyrecipes', 'quick', 'easy') },
  { id: 'meal-prep', label: 'Meal prep', group: 'general', topicIds: tags('mealprep', 'batchcooking') },
  { id: 'baking', label: 'Baking', group: 'general', topicIds: tags('baking', 'bread', 'cake') },
  { id: 'desserts', label: 'Desserts', group: 'general', topicIds: tags('dessert', 'desserts', 'sweets') },
  { id: 'breakfast', label: 'Breakfast', group: 'general', topicIds: tags('breakfast', 'brunch') },
  { id: 'vegetarian', label: 'Vegetarian', group: 'general', topicIds: tags('vegetarian', 'veggie') },
  { id: 'vegan', label: 'Vegan', group: 'general', topicIds: tags('vegan', 'plantbased') },
  { id: 'fitness', label: 'Fitness', group: 'general', topicIds: tags('fitness', 'gym', 'workout', 'training') },
  { id: 'running', label: 'Running', group: 'general', topicIds: tags('running', 'run') },
  { id: 'travel-food', label: 'Food on the road', group: 'general', topicIds: tags('travel', 'streetfood', 'foodtravel') },
  { id: 'budget', label: 'Budget eats', group: 'general', topicIds: tags('budget', 'cheapeats', 'budgetmeals') },
];

/** The viewer's own For You preferences. Private; used by For You only. */
export interface FeedPreferences {
  /** Chosen interest ids that are still in the catalogue. */
  interests: string[];
  /** For You ignores the viewer's likes, comments and reposts before this ("Reset recommendations"). */
  recommendationsResetAt?: string;
}
