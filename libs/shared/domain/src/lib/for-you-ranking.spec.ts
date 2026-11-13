import {
  FOR_YOU_CONFIG,
  forYouReasonText,
  rankForYou,
  scoreCandidate,
  seededOrder,
  signalSince,
  viewerAffinity,
  type ForYouRankInput,
  type RankCandidate,
  type ViewerInteraction,
} from './for-you-ranking';

const NOW = '2026-11-13T12:00:00.000Z';
const hoursAgo = (h: number) => new Date(Date.parse(NOW) - h * 3_600_000).toISOString();
const daysAgo = (d: number) => hoursAgo(d * 24);

const post = (id: string, authorId: string, topicIds: string[] = [], ageHours = 1, engagedMembers = 0): RankCandidate => ({
  id,
  authorId,
  topicIds,
  createdAt: hoursAgo(ageHours),
  engagedMembers,
});
const liked = (topicIds: string[], authorId = 'someone', ageDays = 1, kind: ViewerInteraction['kind'] = 'like'): ViewerInteraction => ({
  postId: `seen-${Math.random()}`,
  authorId,
  topicIds,
  kind,
  at: daysAgo(ageDays),
});
const input = (overrides: Partial<ForYouRankInput>): ForYouRankInput => ({
  viewerId: 'me',
  candidates: [],
  interactions: [],
  now: NOW,
  seed: 'seed-1',
  ...overrides,
});
const order = (ranking: { entries: { postId: string }[] }) => ranking.entries.map((e) => e.postId);

// A pool where different interests should pull different posts up.
const pool = [
  post('pasta', 'a', ['tag:pasta'], 10),
  post('protein', 'b', ['diet:high-protein'], 10),
  post('cake', 'c', ['tag:cake'], 10),
  post('salad', 'd', ['diet:low-calorie'], 10),
];

describe('rankForYou', () => {
  it('stays newest first with no reasons when there is too little to go on', () => {
    const ranking = rankForYou(input({ candidates: [post('old', 'a', [], 50), post('new', 'b', [], 1)], interactions: [liked(['tag:x'])] }));
    expect(ranking.mode).toBe('chronological');
    expect(order(ranking)).toEqual(['new', 'old']);
    expect(ranking.entries.every((entry) => entry.reasons.length === 0)).toBe(true);
  });

  it('orders differently for viewers with different explicit interests, deterministically', () => {
    const pastaFan = input({ candidates: pool, interactions: [liked(['tag:pasta']), liked(['tag:pasta']), liked(['tag:pasta'])] });
    const lifter = input({ candidates: pool, interactions: [liked(['diet:high-protein']), liked(['diet:high-protein']), liked(['diet:high-protein'])] });
    expect(order(rankForYou(pastaFan))[0]).toBe('pasta');
    expect(order(rankForYou(lifter))[0]).toBe('protein');
    expect(rankForYou(pastaFan)).toEqual(rankForYou(pastaFan));
  });

  it('gives a truthful reason for the topic, and never one in the chronological fallback', () => {
    const ranking = rankForYou(input({ candidates: pool, interactions: [liked(['tag:pasta']), liked(['tag:pasta']), liked(['tag:pasta'])] }));
    expect(ranking.entries[0].reasons[0]).toEqual({ code: 'topic', topicId: 'tag:pasta' });
    expect(ranking.entries.find((e) => e.postId === 'cake')?.reasons.some((r) => r.code === 'topic')).toBe(false);
  });

  it('uses chosen interests for a cold start and says so', () => {
    const ranking = rankForYou(input({ candidates: pool, interestTopicIds: ['tag:cake'] }));
    expect(ranking.mode).toBe('ranked');
    expect(ranking.entries[0]).toEqual({ postId: 'cake', reasons: [{ code: 'interest', topicId: 'tag:cake' }] });
  });

  it('ignores interactions before a reset, outside the window, in the future and with own posts', () => {
    const interactions = [liked(['tag:pasta'], 'a', 5), liked(['tag:pasta'], 'a', 120), liked(['tag:pasta'], 'me', 1), { ...liked(['tag:pasta']), at: hoursAgo(-5) }];
    expect(viewerAffinity(input({ interactions })).signals).toBe(1);
    expect(viewerAffinity(input({ interactions, resetAt: daysAgo(2) })).signals).toBe(0);
    expect(signalSince(NOW)).toBe(daysAgo(90));
    expect(signalSince(NOW, daysAgo(2))).toBe(daysAgo(2));
    expect(signalSince(NOW, daysAgo(200))).toBe(daysAgo(90));
  });

  it('weights comments and reposts above likes and lets old interactions fade', () => {
    const like = viewerAffinity(input({ interactions: [liked(['t'], 'x', 0, 'like')] })).topics.get('t') ?? 0;
    const repost = viewerAffinity(input({ interactions: [liked(['t'], 'x', 0, 'repost')] })).topics.get('t') ?? 0;
    const oldLike = viewerAffinity(input({ interactions: [liked(['t'], 'x', 30, 'like')] })).topics.get('t') ?? 0;
    expect(repost).toBeCloseTo(3 * like);
    expect(oldLike).toBeCloseTo(like / 2);
  });

  it('caps engagement so a viral post cannot outrun everything', () => {
    const affinity = viewerAffinity(input({}));
    const capped = scoreCandidate(post('p', 'a', [], 1, FOR_YOU_CONFIG.engagementCap), affinity, new Set(), NOW).engagement;
    const viral = scoreCandidate(post('p', 'a', [], 1, 100_000), affinity, new Set(), NOW).engagement;
    expect(viral).toBe(capped);
  });

  it('keeps at most two posts per author and three per topic on a page, deferring the rest', () => {
    const many = Array.from({ length: 16 }, (_, i) => post(`p${i}`, i < 6 ? 'prolific' : `other${i}`, ['tag:pasta'], i));
    const ranking = rankForYou(input({ candidates: many, interactions: [liked(['tag:pasta'], 'prolific'), liked(['tag:pasta'], 'prolific'), liked(['tag:pasta'], 'prolific')] }));
    const firstPage = ranking.entries.slice(0, 10).map((e) => many.find((c) => c.id === e.postId)!);
    expect(firstPage.filter((c) => c.authorId === 'prolific').length).toBeLessThanOrEqual(2);
    expect(order(ranking).sort()).toEqual(many.map((c) => c.id).sort()); // nothing dropped, nothing twice
  });

  it('gives every fifth slot to something new from a small voice, seeded per session', () => {
    const familiar = Array.from({ length: 8 }, (_, i) => post(`f${i}`, `fan${i}`, [`tag:t${i % 3}`], 1));
    const fresh = Array.from({ length: 4 }, (_, i) => post(`n${i}`, `new${i}`, ['tag:unknown'], 30));
    const interactions = [0, 1, 2].map((i) => liked([`tag:t${i}`]));
    const a = rankForYou(input({ candidates: [...familiar, ...fresh], interactions, seed: 'one' }));
    expect(a.entries[4].reasons).toEqual([{ code: 'explore' }]);
    expect(a.entries[4].postId.startsWith('n')).toBe(true);
    expect(rankForYou(input({ candidates: [...familiar, ...fresh], interactions, seed: 'one' }))).toEqual(a);
    const seeds = new Set(['one', 'two', 'three', 'four', 'five'].map((seed) => rankForYou(input({ candidates: [...familiar, ...fresh], interactions, seed })).entries[4].postId));
    expect(seeds.size).toBeGreaterThan(1);
  });

  it('never includes the viewer’s own posts or a candidate twice', () => {
    const ranking = rankForYou(input({ candidates: [post('mine', 'me'), post('x', 'a'), post('x', 'a')] }));
    expect(order(ranking)).toEqual(['x']);
  });
});

describe('forYouReasonText', () => {
  it('words each reason, and gives none for a topic without its label', () => {
    expect(forYouReasonText({ code: 'topic', topicId: 'diet:high-protein' }, { topicLabel: 'High protein' })).toBe(
      'Because you engaged with posts tagged High protein',
    );
    expect(forYouReasonText({ code: 'interest', topicId: 'tag:cake' }, { topicLabel: '#cake' })).toBe('Matches your interest: #cake');
    expect(forYouReasonText({ code: 'author' }, { authorName: 'Ana' })).toBe("You've engaged with Ana's posts before");
    expect(forYouReasonText({ code: 'topic' })).toBeUndefined();
  });

  it('seededOrder is stable', () => {
    expect(seededOrder('s', 'a')).toBe(seededOrder('s', 'a'));
    expect(seededOrder('s', 'a')).not.toBe(seededOrder('t', 'a'));
  });
});
