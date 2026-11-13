import type { ForYouReasonCode } from '@life-portal/shared-types';

/**
 * For You ranking v1 (#9): a pure, deterministic order for a bounded pool of eligible posts.
 *
 * Inputs are only the viewer's own explicit in-app actions (likes, comments, reposts), their
 * optional chosen interests (#10), each candidate's published topics (#8), its age and how many
 * distinct members engaged with it. Never nutrition logs, weight, targets, Apple Health, imports
 * or impression tracking (owner decisions on #3 and #9). Eligibility (audience, blocks, mutes,
 * reports, Not interested) is decided before this runs and again when a page is served.
 *
 * `now` and `seed` are explicit (principle V): the same inputs always give the same order, and
 * exploration varies only with the session's seed.
 */

export const FOR_YOU_CONFIG = {
  /** Interactions older than this are ignored. */
  windowDays: 90,
  /** How many posts one session orders. */
  sessionSize: 300,
  pageSize: 10,
  /** Weight of each kind of interaction toward topic and author affinity. */
  interactionWeights: { like: 1, comment: 2, repost: 3 } as Record<ViewerInteractionKind, number>,
  /** An interaction's weight halves every this many days. */
  affinityHalfLifeDays: 30,
  /** What a chosen interest is worth, as if it were a strong recent interaction. */
  interestAffinity: 2,
  topicWeight: 1,
  authorWeight: 1.2,
  freshnessWeight: 1,
  /** Freshness halves every this many hours. */
  freshnessHalfLifeHours: 72,
  engagementWeight: 0.5,
  /** Engaged members past this add nothing more, so one viral post cannot dominate. */
  engagementCap: 50,
  /** Below this many interactions (and no interests) the feed stays chronological. */
  minSignals: 3,
  /** Every this-many-th slot goes to a post outside the viewer's usual, when one is left. */
  exploreEvery: 5,
  /** A post with fewer engaged members than this counts as from a small or new voice. */
  exploreMaxEngagement: 3,
  authorPerPage: 2,
  topicPerPage: 3,
  /** Reasons need this much: affinity for a topic, interactions with an author, members. */
  topicReasonMin: 1,
  authorReasonMin: 2,
  popularMembers: 5,
  freshHours: 48,
} as const;

export type ForYouConfig = typeof FOR_YOU_CONFIG;
export type ViewerInteractionKind = 'like' | 'comment' | 'repost';

export interface ViewerInteraction {
  postId: string;
  authorId: string;
  topicIds: readonly string[];
  kind: ViewerInteractionKind;
  /** ISO timestamp. */
  at: string;
}

export interface RankCandidate {
  id: string;
  authorId: string;
  /** ISO timestamp. */
  createdAt: string;
  topicIds: readonly string[];
  /** Distinct other members who liked, commented on or reposted it. */
  engagedMembers: number;
}

export interface RankedReason {
  code: ForYouReasonCode;
  topicId?: string;
}

export interface RankedEntry {
  postId: string;
  reasons: RankedReason[];
}

export interface ForYouRankInput {
  viewerId: string;
  candidates: readonly RankCandidate[];
  interactions: readonly ViewerInteraction[];
  /** Topic ids the viewer chose (#10); optional. */
  interestTopicIds?: readonly string[];
  /** Interactions before this are ignored ("Reset recommendations", #10); optional ISO. */
  resetAt?: string;
  now: string;
  seed: string;
  config?: ForYouConfig;
}

export interface ForYouRanking {
  /** `chronological` when there is too little to personalise on; such entries carry no reasons. */
  mode: 'ranked' | 'chronological';
  entries: RankedEntry[];
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** A small, stable string hash (FNV-1a), for seeded exploration. Not for security. */
export function seededOrder(seed: string, id: string): number {
  let hash = 0x811c9dc5;
  for (const char of `${seed}:${id}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/** The first moment an interaction still counts: the window, or a later reset. */
export function signalSince(now: string, resetAt?: string, config: ForYouConfig = FOR_YOU_CONFIG): string {
  const window = new Date(Date.parse(now) - config.windowDays * DAY).toISOString();
  return resetAt && resetAt > window ? resetAt : window;
}

interface Affinity {
  topics: Map<string, number>;
  authors: Map<string, number>;
  authorCounts: Map<string, number>;
  signals: number;
}

export function viewerAffinity(input: ForYouRankInput): Affinity {
  const config = input.config ?? FOR_YOU_CONFIG;
  const since = signalSince(input.now, input.resetAt, config);
  const now = Date.parse(input.now);
  const affinity: Affinity = { topics: new Map(), authors: new Map(), authorCounts: new Map(), signals: 0 };
  for (const interaction of input.interactions) {
    if (interaction.authorId === input.viewerId || interaction.at < since || interaction.at > input.now) continue;
    const weight =
      config.interactionWeights[interaction.kind] *
      0.5 ** ((now - Date.parse(interaction.at)) / DAY / config.affinityHalfLifeDays);
    affinity.signals += 1;
    for (const topic of new Set(interaction.topicIds)) {
      affinity.topics.set(topic, (affinity.topics.get(topic) ?? 0) + weight);
    }
    affinity.authors.set(interaction.authorId, (affinity.authors.get(interaction.authorId) ?? 0) + weight);
    affinity.authorCounts.set(interaction.authorId, (affinity.authorCounts.get(interaction.authorId) ?? 0) + 1);
  }
  return affinity;
}

const newestFirst = (a: RankCandidate, b: RankCandidate) =>
  b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);

/** The candidate's score and its parts, for tests and the docs. */
export function scoreCandidate(
  candidate: RankCandidate,
  affinity: Affinity,
  interests: ReadonlySet<string>,
  now: string,
  config: ForYouConfig = FOR_YOU_CONFIG,
) {
  const topicAffinity = candidate.topicIds.reduce(
    (sum, topic) => sum + (affinity.topics.get(topic) ?? 0) + (interests.has(topic) ? config.interestAffinity : 0),
    0,
  );
  const relevance =
    config.topicWeight * Math.log1p(topicAffinity) +
    config.authorWeight * Math.log1p(affinity.authors.get(candidate.authorId) ?? 0);
  const ageHours = Math.max(0, (Date.parse(now) - Date.parse(candidate.createdAt)) / HOUR);
  const freshness = config.freshnessWeight * 0.5 ** (ageHours / config.freshnessHalfLifeHours);
  const engagement =
    config.engagementWeight * Math.log1p(Math.min(Math.max(0, candidate.engagedMembers), config.engagementCap));
  return { relevance, freshness, engagement, total: relevance + freshness + engagement };
}

function reasonsFor(
  candidate: RankCandidate,
  affinity: Affinity,
  interests: ReadonlySet<string>,
  now: string,
  config: ForYouConfig,
): RankedReason[] {
  const reasons: RankedReason[] = [];
  const interest = candidate.topicIds.find((topic) => interests.has(topic));
  if (interest) reasons.push({ code: 'interest', topicId: interest });
  else {
    let best: string | undefined;
    for (const topic of candidate.topicIds) {
      const value = affinity.topics.get(topic) ?? 0;
      if (value >= config.topicReasonMin && (!best || value > (affinity.topics.get(best) ?? 0))) best = topic;
    }
    if (best) reasons.push({ code: 'topic', topicId: best });
  }
  if ((affinity.authorCounts.get(candidate.authorId) ?? 0) >= config.authorReasonMin) reasons.push({ code: 'author' });
  if (candidate.engagedMembers >= config.popularMembers) reasons.push({ code: 'popular' });
  if (!reasons.length && Date.parse(now) - Date.parse(candidate.createdAt) <= config.freshHours * HOUR) {
    reasons.push({ code: 'fresh' });
  }
  return reasons.slice(0, 2);
}

/**
 * Fills pages of `pageSize` in order, at most `authorPerPage` posts by one author and
 * `topicPerPage` sharing a topic on a page. When nothing left fits, the topic limit gives way
 * first, then the author limit: a post is deferred to a later page, never dropped. `explore`
 * supplies every `exploreEvery`-th slot when it can.
 */
function assemble(
  ordered: RankCandidate[],
  explore: RankCandidate[],
  config: ForYouConfig,
  limitAuthorsOnly: boolean,
): { candidate: RankCandidate; explored: boolean }[] {
  const left = [...ordered];
  const exploring = [...explore];
  const placed = new Set<string>();
  const result: { candidate: RankCandidate; explored: boolean }[] = [];
  let authors = new Map<string, number>();
  let topics = new Map<string, number>();
  type Rule = 'both' | 'author' | 'none';
  const fits = (candidate: RankCandidate, rule: Rule) =>
    rule === 'none' ||
    ((authors.get(candidate.authorId) ?? 0) < config.authorPerPage &&
      (rule === 'author' || limitAuthorsOnly || candidate.topicIds.every((topic) => (topics.get(topic) ?? 0) < config.topicPerPage)));
  const take = (list: RankCandidate[], rule: Rule) => {
    const index = list.findIndex((candidate) => !placed.has(candidate.id) && fits(candidate, rule));
    return index < 0 ? undefined : list.splice(index, 1)[0];
  };
  while (result.length < config.sessionSize) {
    if (result.length % config.pageSize === 0) {
      authors = new Map();
      topics = new Map();
    }
    const slot = result.length + 1;
    let explored = false;
    let next: RankCandidate | undefined;
    if (slot % config.exploreEvery === 0) {
      next = take(exploring, 'both');
      explored = !!next;
    }
    // The topic limit gives way before the author limit, and both only when nothing else is left.
    next ??= take(left, 'both') ?? take(left, 'author') ?? take(left, 'none');
    if (!next) break;
    placed.add(next.id);
    authors.set(next.authorId, (authors.get(next.authorId) ?? 0) + 1);
    for (const topic of new Set(next.topicIds)) topics.set(topic, (topics.get(topic) ?? 0) + 1);
    result.push({ candidate: next, explored });
  }
  return result;
}

export function rankForYou(input: ForYouRankInput): ForYouRanking {
  const config = input.config ?? FOR_YOU_CONFIG;
  const seen = new Set<string>();
  const candidates = input.candidates.filter(
    (candidate) => candidate.authorId !== input.viewerId && !seen.has(candidate.id) && !!seen.add(candidate.id),
  );
  const interests = new Set(input.interestTopicIds ?? []);
  const affinity = viewerAffinity(input);

  if (affinity.signals < config.minSignals && !interests.size) {
    const chronological = assemble([...candidates].sort(newestFirst), [], config, true);
    return { mode: 'chronological', entries: chronological.map(({ candidate }) => ({ postId: candidate.id, reasons: [] })) };
  }

  const scores = new Map(candidates.map((c) => [c.id, scoreCandidate(c, affinity, interests, input.now, config).total]));
  const ordered = [...candidates].sort((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0) || newestFirst(a, b));
  const unfamiliar = (c: RankCandidate) =>
    !affinity.authors.has(c.authorId) &&
    c.topicIds.every((topic) => !affinity.topics.has(topic) && !interests.has(topic)) &&
    c.engagedMembers < config.exploreMaxEngagement;
  const explore = candidates
    .filter(unfamiliar)
    .sort((a, b) => seededOrder(input.seed, a.id) - seededOrder(input.seed, b.id) || a.id.localeCompare(b.id));
  return {
    mode: 'ranked',
    entries: assemble(ordered, explore, config, false).map(({ candidate, explored }) => ({
      postId: candidate.id,
      reasons: explored ? [{ code: 'explore' }] : reasonsFor(candidate, affinity, interests, input.now, config),
    })),
  };
}

/** The words for a reason. `topicLabel` for interest/topic, `authorName` for author. */
export function forYouReasonText(
  reason: RankedReason,
  labels: { topicLabel?: string; authorName?: string } = {},
): string | undefined {
  switch (reason.code) {
    case 'interest':
      return labels.topicLabel ? `Matches your interest: ${labels.topicLabel}` : undefined;
    case 'topic':
      return labels.topicLabel ? `Because you engaged with posts tagged ${labels.topicLabel}` : undefined;
    case 'author':
      return `You've engaged with ${labels.authorName ?? 'this author'}'s posts before`;
    case 'popular':
      return 'Popular with members';
    case 'explore':
      return 'Something new, outside what you usually engage with';
    case 'fresh':
      return 'Posted recently';
  }
}

