import {
  FEED_METRICS_CONFIG,
  perMille,
  quotaAllows,
  returningDays,
  summariseFeedMetrics,
  uniqueEvents,
  videoMilestones,
} from './feed-metrics';
import type { FeedMetricInput } from '@life-portal/shared-types';

describe('feed metrics (#11)', () => {
  it('keeps one of each post and event, drops unknown events and caps the batch', () => {
    const events = [
      { postId: 'a', type: 'impression' },
      { postId: 'a', type: 'impression' },
      { postId: 'a', type: 'like' },
      { postId: 'b', type: 'peek' },
    ] as FeedMetricInput[];
    expect(uniqueEvents(events)).toEqual([
      { postId: 'a', type: 'impression' },
      { postId: 'a', type: 'like' },
    ]);
    const many = Array.from({ length: 80 }, (_, i) => ({ postId: `p${i}`, type: 'impression' as const }));
    expect(uniqueEvents(many)).toHaveLength(FEED_METRICS_CONFIG.maxBatch);
  });

  it('lets a batch use only what is left of the daily cap', () => {
    expect(quotaAllows(10, 10)).toBe(10);
    expect(quotaAllows(2010, 20)).toBe(10);
    expect(quotaAllows(2050, 20)).toBe(0);
  });

  it('reports each video milestone once', () => {
    expect(videoMilestones(0.6, new Set())).toEqual(['video25', 'video50']);
    expect(videoMilestones(0.99, new Set(['video25', 'video50']))).toEqual(['video75', 'video100']);
  });

  it('shows no rate over a small denominator', () => {
    expect(perMille(3, 10)).toBeNull();
    expect(perMille(3, 30)).toBe(100);
    expect(perMille(0, 0, 0)).toBeNull();
  });

  it('looks back seven days for a returning visit', () => {
    expect(returningDays('2026-11-13')).toEqual([
      '2026-11-12', '2026-11-11', '2026-11-10', '2026-11-09', '2026-11-08', '2026-11-07', '2026-11-06',
    ]);
  });

  it('summarises totals, days and the most-seen posts, with rates only above the minimum', () => {
    const report = summariseFeedMetrics(
      [
        { day: '2026-11-12', postId: '', counts: { impression: 40, like: 4, videoStart: 10, video100: 5 }, visitors: 40, returningVisitors: 10 },
        { day: '2026-11-13', postId: '', counts: { impression: 20, comment: 2 }, visitors: 5, returningVisitors: 4 },
        { day: '2026-11-01', postId: '', counts: { impression: 999 } },
        { day: '2026-11-12', postId: 'p1', counts: { impression: 30, like: 3 } },
        { day: '2026-11-13', postId: 'p1', counts: { impression: 5, repost: 1 } },
        { day: '2026-11-13', postId: 'p2', counts: { impression: 12, videoStart: 12, quickSkip: 6 } },
      ],
      '2026-11-07',
      '2026-11-13',
    );
    expect(report.totals.counts).toEqual({ impression: 60, like: 4, comment: 2, videoStart: 10, video100: 5 });
    expect(report.totals.engagementRate).toBe(100);
    expect(report.totals.completionRate).toBeNull();
    expect(report.days.map((d) => [d.day, d.returningRate])).toEqual([
      ['2026-11-13', null],
      ['2026-11-12', 250],
    ]);
    expect(report.posts.map((p) => [p.postId, p.counts.impression, p.engagementRate, p.quickSkipRate])).toEqual([
      ['p1', 35, 114, null],
      ['p2', 12, null, null],
    ]);
  });
});
