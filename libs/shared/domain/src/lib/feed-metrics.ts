import {
  FEED_METRIC_EVENTS,
  type FeedMetricCounts,
  type FeedMetricEvent,
  type FeedMetricInput,
  type FeedMetricsDay,
  type FeedMetricsPost,
  type FeedMetricsReport,
  type PerMille,
} from '@life-portal/shared-types';
import { addDays } from './dates';

/**
 * For You measurement (#11): pure rules for what a batch may contain and how the developer view
 * summarises the daily aggregates. The API owns keys, storage and eligibility.
 */
export const FEED_METRICS_CONFIG = {
  /** Events in one request. */
  maxBatch: 50,
  /** Events accepted per account per day; the rest are dropped, not queued. */
  dailyCap: 2000,
  /** Days a de-duplication key lives: long enough to cover the day it belongs to. */
  keyDays: 2,
  /** Days a visit key lives: today plus the window "returning" looks back over. */
  visitDays: 8,
  /** "Returning" means a visit on any of this many previous days. */
  returningWindow: 7,
  /** Days a daily aggregate row lives. */
  aggregateDays: 90,
  /** No rate is shown over fewer than this many impressions, starts or visitors. */
  minDenominator: 30,
  /** Posts listed in the developer view. */
  postLimit: 50,
  /** In the browser: an impression is at least this much of a card visible for this long. */
  visibleRatio: 0.5,
  visibleMs: 1000,
  /** A video left before this many ms of playback is a quick skip. */
  quickSkipMs: 2000,
  /** The browser sends what it has at most this often, and on leaving the page. */
  flushMs: 15_000,
} as const;

const ENGAGEMENT: readonly FeedMetricEvent[] = ['like', 'comment', 'repost'];

export const isFeedMetricEvent = (value: unknown): value is FeedMetricEvent =>
  typeof value === 'string' && (FEED_METRIC_EVENTS as readonly string[]).includes(value);

/** One of each post and event; unknown events and anything past `maxBatch` are dropped. */
export function uniqueEvents(events: FeedMetricInput[]): FeedMetricInput[] {
  const seen = new Set<string>();
  const out: FeedMetricInput[] = [];
  for (const event of events) {
    if (out.length >= FEED_METRICS_CONFIG.maxBatch) break;
    if (!isFeedMetricEvent(event.type)) continue;
    const key = `${event.postId}:${event.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(event);
  }
  return out;
}

/** How many of `wanted` events still fit today, given the count already used (after this batch). */
export function quotaAllows(usedIncludingBatch: number, wanted: number): number {
  const before = usedIncludingBatch - wanted;
  return Math.max(0, Math.min(wanted, FEED_METRICS_CONFIG.dailyCap - before));
}

/** The video milestones crossed by a play position, as events, given those already sent. */
export function videoMilestones(fraction: number, sent: ReadonlySet<FeedMetricEvent>): FeedMetricEvent[] {
  const marks: [number, FeedMetricEvent][] = [
    [0.25, 'video25'],
    [0.5, 'video50'],
    [0.75, 'video75'],
    [0.98, 'video100'],
  ];
  return marks.filter(([at, type]) => fraction >= at && !sent.has(type)).map(([, type]) => type);
}

/** `numerator / denominator` per thousand, or `null` below the minimum denominator. */
export function perMille(numerator: number, denominator: number, min: number = FEED_METRICS_CONFIG.minDenominator): PerMille {
  if (denominator < min || denominator <= 0) return null;
  return Math.round((numerator * 1000) / denominator);
}

/** The visit keys' days that make a visit today "returning". */
export function returningDays(day: string): string[] {
  return Array.from({ length: FEED_METRICS_CONFIG.returningWindow }, (_, i) => addDays(day, -(i + 1)));
}

export interface FeedMetricsRow {
  day: string;
  /** `''` for the day's totals. */
  postId: string;
  counts?: FeedMetricCounts;
  visitors?: number;
  returningVisitors?: number;
}

function addCounts(into: FeedMetricCounts, from: FeedMetricCounts = {}) {
  for (const type of FEED_METRIC_EVENTS) {
    const value = from[type];
    if (value) into[type] = (into[type] ?? 0) + value;
  }
  return into;
}

function postSummary(postId: string, counts: FeedMetricCounts, min: number): FeedMetricsPost {
  const impressions = counts.impression ?? 0;
  const starts = counts.videoStart ?? 0;
  const engaged = ENGAGEMENT.reduce((sum, type) => sum + (counts[type] ?? 0), 0);
  return {
    postId,
    counts,
    engagementRate: perMille(engaged, impressions, min),
    completionRate: perMille(counts.video100 ?? 0, starts, min),
    quickSkipRate: perMille(counts.quickSkip ?? 0, starts, min),
  };
}

/**
 * The developer view for `from`…`to` (inclusive): totals, one row per day and the posts with the
 * most impressions. Counts are always shown; rates only over at least `minDenominator`.
 */
export function summariseFeedMetrics(
  rows: FeedMetricsRow[],
  from: string,
  to: string,
  min: number = FEED_METRICS_CONFIG.minDenominator,
  postLimit: number = FEED_METRICS_CONFIG.postLimit,
): FeedMetricsReport {
  const inRange = rows.filter((row) => row.day >= from && row.day <= to);
  const days = new Map<string, FeedMetricsDay>();
  const posts = new Map<string, FeedMetricCounts>();
  const totals: FeedMetricCounts = {};
  for (const row of inRange) {
    if (row.postId) {
      addCounts((posts.get(row.postId) ?? posts.set(row.postId, {}).get(row.postId)) as FeedMetricCounts, row.counts);
      continue;
    }
    addCounts(totals, row.counts);
    const day = days.get(row.day) ?? { day: row.day, counts: {}, visitors: 0, returningVisitors: 0, returningRate: null };
    addCounts(day.counts, row.counts);
    day.visitors += row.visitors ?? 0;
    day.returningVisitors += row.returningVisitors ?? 0;
    days.set(row.day, day);
  }
  return {
    from,
    to,
    minDenominator: min,
    totals: postSummary('', totals, min),
    days: [...days.values()]
      .map((day) => ({ ...day, returningRate: perMille(day.returningVisitors, day.visitors, min) }))
      .sort((a, b) => (a.day < b.day ? 1 : -1)),
    posts: [...posts.entries()]
      .map(([postId, counts]) => postSummary(postId, counts, min))
      .sort((a, b) => (b.counts.impression ?? 0) - (a.counts.impression ?? 0) || (a.postId < b.postId ? -1 : 1))
      .slice(0, postLimit),
  };
}
