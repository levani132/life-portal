import { FOR_YOU_INTERESTS, MAX_FOR_YOU_INTERESTS, type ForYouInterest } from '@life-portal/shared-types';

/**
 * Chosen interests (#10) for For You. An id outside the catalogue is never stored (400 on write)
 * and ignored on read, so retiring an interest never breaks anyone.
 */

const BY_ID = new Map(FOR_YOU_INTERESTS.map((interest) => [interest.id, interest]));

export const isForYouInterest = (id: string) => BY_ID.has(id);

/** Known interests only, in catalogue order, without repeats. */
export function knownInterests(ids: readonly string[] | undefined): string[] {
  const chosen = new Set(ids ?? []);
  return FOR_YOU_INTERESTS.filter((interest) => chosen.has(interest.id)).map((interest) => interest.id);
}

/** Why a write is refused, or undefined when it may be stored. */
export function interestsProblem(ids: readonly unknown[]): string | undefined {
  if (ids.length > MAX_FOR_YOU_INTERESTS) return `Choose at most ${MAX_FOR_YOU_INTERESTS} interests.`;
  const unknown = ids.filter((id) => typeof id !== 'string' || !BY_ID.has(id));
  return unknown.length ? `Unknown interest: ${unknown.map(String).join(', ')}.` : undefined;
}

/** The post topics the chosen interests match, for ranking. */
export function interestTopicIds(ids: readonly string[] | undefined): string[] {
  return [...new Set(knownInterests(ids).flatMap((id) => BY_ID.get(id)?.topicIds ?? []))];
}

/** The chosen interest that matches a topic, for the "Matches your interest" reason. */
export function interestForTopic(ids: readonly string[] | undefined, topicId: string): ForYouInterest | undefined {
  return knownInterests(ids)
    .map((id) => BY_ID.get(id) as ForYouInterest)
    .find((interest) => interest.topicIds.includes(topicId));
}
