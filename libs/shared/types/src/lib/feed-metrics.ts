/**
 * For You measurement (#11), behind `forYouMetrics`, which is off for every account until the
 * owner turns it on. Only aggregate daily counts are kept; see docs/modules/posts.md.
 */

/** Per-post events. Engagement events are re-checked against the stored like/comment/repost/feedback. */
export const FEED_METRIC_EVENTS = [
  'impression',
  'videoStart',
  'video25',
  'video50',
  'video75',
  'video100',
  'quickSkip',
  'like',
  'comment',
  'repost',
  'notInterested',
] as const;
export type FeedMetricEvent = (typeof FEED_METRIC_EVENTS)[number];

export interface FeedMetricInput {
  postId: string;
  type: FeedMetricEvent;
}

/** `POST /posts/for-you/metrics`. `visit` marks the first batch of a For You page load. */
export interface FeedMetricsBatch {
  events: FeedMetricInput[];
  visit?: boolean;
}

export interface FeedMetricsResult {
  accepted: number;
  dropped: number;
}

/** Whether this account's For You viewing is measured, and why not. */
export interface FeedMetricsStatus {
  /** `forYouMetrics` is on for the account. */
  enabled: boolean;
  optedOut: boolean;
  /** Measurement runs only when enabled and not opted out. */
  active: boolean;
}

export type FeedMetricCounts = Partial<Record<FeedMetricEvent, number>>;

/**
 * A rate as a whole number per thousand, or `null` when its denominator is below the minimum
 * (a rate over a handful of views says more about the few viewers than about the post).
 */
export type PerMille = number | null;

export interface FeedMetricsDay {
  day: string;
  counts: FeedMetricCounts;
  visitors: number;
  returningVisitors: number;
  /** returningVisitors / visitors. */
  returningRate: PerMille;
}

export interface FeedMetricsPost {
  postId: string;
  counts: FeedMetricCounts;
  /** Likes, comments and reposts per impression. */
  engagementRate: PerMille;
  /** Finished / started videos. */
  completionRate: PerMille;
  /** Quick skips / started videos. */
  quickSkipRate: PerMille;
}

export const FEED_METRICS_RANGES = [7, 28] as const;
export type FeedMetricsRange = (typeof FEED_METRICS_RANGES)[number];

/** `GET /posts/for-you/metrics/report` — developer only, aggregates only. */
export interface FeedMetricsReport {
  from: string;
  to: string;
  minDenominator: number;
  totals: FeedMetricsPost;
  days: FeedMetricsDay[];
  /** At most `postLimit` posts, by impressions. */
  posts: FeedMetricsPost[];
}
