import { DIET_TOPICS, FOR_YOU_INTERESTS } from '@life-portal/shared-types';
import { captionHashtags } from './post-topics';
import { interestForTopic, interestTopicIds, interestsProblem, isForYouInterest, knownInterests } from './for-you-interests';

describe('For You interests', () => {
  it('has unique ids, every diet topic, and hashtags the caption parser can produce', () => {
    expect(new Set(FOR_YOU_INTERESTS.map((i) => i.id)).size).toBe(FOR_YOU_INTERESTS.length);
    for (const diet of DIET_TOPICS) expect(FOR_YOU_INTERESTS.some((i) => i.topicIds.includes(`diet:${diet}`))).toBe(true);
    for (const id of FOR_YOU_INTERESTS.flatMap((i) => i.topicIds).filter((t) => t.startsWith('tag:'))) {
      expect(captionHashtags(`#${id.slice(4)}`)).toEqual([id.slice(4)]);
    }
    expect(FOR_YOU_INTERESTS.filter((i) => i.group === 'general').length).toBeGreaterThanOrEqual(10);
  });

  it('keeps known ids in catalogue order, dropping retired and repeated ones', () => {
    expect(knownInterests(['vegan', 'retired-thing', 'baking', 'vegan'])).toEqual(['baking', 'vegan']);
    expect(knownInterests(undefined)).toEqual([]);
    expect(isForYouInterest('baking')).toBe(true);
  });

  it('refuses unknown ids and too many on write', () => {
    expect(interestsProblem(['baking'])).toBeUndefined();
    expect(interestsProblem(['baking', 'nope'])).toBe('Unknown interest: nope.');
    expect(interestsProblem(Array.from({ length: 21 }, () => 'baking'))).toMatch(/at most 20/);
  });

  it('maps interests to post topics and back', () => {
    expect(interestTopicIds(['baking', 'high-protein']).sort()).toEqual(['diet:high-protein', 'tag:baking', 'tag:bread', 'tag:cake'].sort());
    expect(interestForTopic(['baking'], 'tag:bread')?.label).toBe('Baking');
    expect(interestForTopic(['vegan'], 'tag:bread')).toBeUndefined();
  });
});
