import type { FoodPublication, PublishedFood } from '@life-portal/shared-types';
import { MAX_POST_HASHTAGS, captionHashtags, dietTopics, postTopics } from './post-topics';

/** Per 100 g unless overridden. Macros in mg, as published. */
function food(overrides: Partial<PublishedFood> = {}): PublishedFood {
  return {
    key: 'k',
    name: 'Food',
    unit: 'g',
    servingSize: 100,
    energyKcalPer100: 200,
    proteinMgPer100: 10_000,
    carbMgPer100: 20_000,
    fatMgPer100: 8_000,
    ...overrides,
  };
}
const pub = (kind: FoodPublication['kind'], items: PublishedFood[]) => ({ kind, items });
const ids = (topics: { id: string }[]) => topics.map((topic) => topic.id);

describe('dietTopics (issue #8)', () => {
  it('tags chicken breast as high protein, low carb and low fat, with a basis', () => {
    const chicken = food({ energyKcalPer100: 120, proteinMgPer100: 23_000, carbMgPer100: 0, fatMgPer100: 2_500 });
    const topics = dietTopics(pub('food', [chicken]));
    expect(ids(topics)).toEqual(['diet:high-protein', 'diet:low-carb', 'diet:low-fat']);
    expect(topics[0]).toMatchObject({ kind: 'diet', label: 'High protein', basis: expect.stringContaining('20%') });
  });

  it('uses energy shares at the boundaries: 20% protein counts, 26% carbs does not', () => {
    // 4 kcal/g protein and carbs, 9 kcal/g fat, 400 kcal of macros: exactly 20% protein, 26% carbs.
    const exact = food({ proteinMgPer100: 20_000, carbMgPer100: 26_000, fatMgPer100: (400 - 80 - 104) / 9 * 1000 });
    expect(ids(dietTopics(pub('food', [exact])))).toEqual(['diet:high-protein']);
    const under = food({ proteinMgPer100: 19_000, carbMgPer100: 25_000, fatMgPer100: (400 - 76 - 100) / 9 * 1000 });
    expect(ids(dietTopics(pub('food', [under])))).toEqual(['diet:low-carb']);
  });

  it('weighs a meal by amount across its items', () => {
    // 600 g rice (low protein, high carb) and 100 g chicken: about 18% protein, not high protein.
    const rice = food({ energyKcalPer100: 130, proteinMgPer100: 2_700, carbMgPer100: 28_000, fatMgPer100: 300, amount: 600 });
    const chicken = food({ energyKcalPer100: 120, proteinMgPer100: 23_000, carbMgPer100: 0, fatMgPer100: 2_500, amount: 100 });
    expect(ids(dietTopics(pub('meal', [rice, chicken])))).toEqual(['diet:low-fat']);
    // The same chicken alone, eaten in a larger portion, is still high protein.
    expect(ids(dietTopics(pub('entry', [{ ...chicken, amount: 250 }])))).toContain('diet:high-protein');
  });

  it('gives no tags when a multi-item post has an item without an amount', () => {
    const items = [food({ amount: 100 }), food({ amount: undefined })];
    expect(dietTopics(pub('combination', items))).toEqual([]);
  });

  it('applies per-100 rules only to one unit, and uses the millilitre thresholds', () => {
    const water = food({ unit: 'ml', energyKcalPer100: 0, proteinMgPer100: 0, carbMgPer100: 0, fatMgPer100: 0, sugarMgPer100: 0 });
    expect(ids(dietTopics(pub('food', [water])))).toEqual(['diet:low-fat', 'diet:low-calorie', 'diet:low-sugar']);
    const juice = food({ unit: 'ml', energyKcalPer100: 21, proteinMgPer100: 0, carbMgPer100: 5_000, fatMgPer100: 1_600, sugarMgPer100: 2_600 });
    expect(ids(dietTopics(pub('food', [juice])))).toEqual([]);
    const mixed = [
      food({ amount: 100, energyKcalPer100: 30, fatMgPer100: 0, proteinMgPer100: 0, carbMgPer100: 7_500 }),
      food({ amount: 100, unit: 'ml', energyKcalPer100: 0, fatMgPer100: 0, proteinMgPer100: 0, carbMgPer100: 0 }),
    ];
    expect(ids(dietTopics(pub('meal', mixed)))).toEqual([]);
  });

  it('needs sugar and fibre on every item, never inferring a missing value', () => {
    const oats = food({ energyKcalPer100: 370, proteinMgPer100: 13_000, carbMgPer100: 60_000, fatMgPer100: 7_000, fibreMgPer100: 10_000, sugarMgPer100: 1_000, amount: 50 });
    expect(ids(dietTopics(pub('entry', [oats])))).toEqual(['diet:low-sugar', 'diet:high-fibre']);
    const withUnknown = [oats, food({ amount: 50, fibreMgPer100: undefined, sugarMgPer100: undefined })];
    expect(ids(dietTopics(pub('meal', withUnknown)))).toEqual([]);
  });

  it('counts fibre per 100 kcal too', () => {
    // 4 g fibre per 100 g is under 6 g, but 4 g per 100 kcal clears 3 g per 100 kcal.
    const greens = food({ energyKcalPer100: 100, proteinMgPer100: 3_000, carbMgPer100: 15_000, fatMgPer100: 3_500, fibreMgPer100: 4_000 });
    expect(ids(dietTopics(pub('food', [greens])))).toContain('diet:high-fibre');
  });

  it('skips per-100 rules for a day, but a day can still be high protein', () => {
    const lean = food({ energyKcalPer100: 100, proteinMgPer100: 20_000, carbMgPer100: 2_000, fatMgPer100: 1_000, amount: 500 });
    expect(ids(dietTopics(pub('day', [lean, { ...lean, key: 'b' }])))).toEqual(['diet:high-protein', 'diet:low-carb']);
  });

  it('gives nothing for zero energy macros or an empty publication', () => {
    expect(dietTopics(pub('meal', []))).toEqual([]);
    const nothing = food({ energyKcalPer100: 0, proteinMgPer100: 0, carbMgPer100: 0, fatMgPer100: 0 });
    expect(ids(dietTopics(pub('day', [nothing])))).toEqual([]);
  });
});

describe('captionHashtags (issue #8)', () => {
  it('lower-cases, deduplicates and keeps first-appearance order', () => {
    expect(captionHashtags('#Pasta night with #friends! #pasta #FRIENDS #Travel')).toEqual(['pasta', 'friends', 'travel']);
  });

  it('reads any script and keeps general interests', () => {
    expect(captionHashtags('ვახშამი #ხაჭაპური და #Café #mañana #road_trip')).toEqual(['ხაჭაპური', 'café', 'mañana', 'road_trip']);
  });

  it('normalises composed and decomposed forms to the same tag', () => {
    expect(captionHashtags('#café #café')).toEqual(['café']);
  });

  it('ignores tags inside words, URLs and entities, numbers only, and bare #', () => {
    expect(captionHashtags('a#b example.com/#anchor &#39; #123 # alone ##double (#ok)')).toEqual(['ok']);
  });

  it('stops at punctuation and skips tags over 50 characters', () => {
    expect(captionHashtags('#protein, #gains. #legday!')).toEqual(['protein', 'gains', 'legday']);
    expect(captionHashtags(`#${'a'.repeat(51)} #${'b'.repeat(50)}`)).toEqual(['b'.repeat(50)]);
  });

  it(`keeps at most ${MAX_POST_HASHTAGS}`, () => {
    const caption = Array.from({ length: 14 }, (_, i) => `#t${String.fromCharCode(97 + i)}`).join(' ');
    expect(captionHashtags(caption)).toHaveLength(MAX_POST_HASHTAGS);
  });
});

describe('postTopics (issue #8)', () => {
  it('puts diet tags first, then hashtags, each with a stable id and a basis', () => {
    const chicken = food({ energyKcalPer100: 120, proteinMgPer100: 23_000, carbMgPer100: 0, fatMgPer100: 2_500 });
    const topics = postTopics({ caption: 'Lunch #MealPrep', publication: pub('food', [chicken]) });
    expect(ids(topics)).toEqual(['diet:high-protein', 'diet:low-carb', 'diet:low-fat', 'tag:mealprep']);
    expect(topics[3]).toEqual({ id: 'tag:mealprep', kind: 'hashtag', label: '#mealprep', basis: 'Hashtag in the caption' });
  });

  it('gives a post without food its hashtags only', () => {
    expect(postTopics({ caption: 'Sunset #travel' })).toEqual([
      { id: 'tag:travel', kind: 'hashtag', label: '#travel', basis: 'Hashtag in the caption' },
    ]);
    expect(postTopics({ caption: '' })).toEqual([]);
  });
});
