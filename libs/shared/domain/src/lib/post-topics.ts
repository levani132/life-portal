import type {
  DietTopic,
  FoodPublication,
  PostTopic,
  PublishedFood,
} from '@life-portal/shared-types';
import { macroShares } from './post-media';

/**
 * A post's topics (issue #8): diet tags from its published food facts and hashtags from its
 * caption. Pure and computed on read; nothing here is stored, and only published content is read
 * (never meals, weigh-ins, targets or health data). Docs: `docs/modules/posts.md`.
 *
 * Diet thresholds follow the EU nutrition-claim definitions (Regulation 1924/2006) where one
 * exists; low-carb uses the common < 26 % of energy definition. A tag needs every fact it reads:
 * a missing amount, a mix of grams and millilitres, or an item without sugar or fibre means no
 * tag, never a guess. Plant-based is deliberately absent: no published fact says it.
 */

export const MAX_POST_HASHTAGS = 10;
export const MAX_HASHTAG_LENGTH = 50;

const DIET_LABELS: Record<DietTopic, string> = {
  'high-protein': 'High protein',
  'low-carb': 'Low carb',
  'low-fat': 'Low fat',
  'low-calorie': 'Low calorie',
  'low-sugar': 'Low sugar',
  'high-fibre': 'High fibre',
};

/** What the whole publication adds up to, or undefined when it cannot be weighed. */
interface Composition {
  /** Base units (g or ml) the totals are over; 100 for a lone food without an amount. */
  amount: number;
  /** One unit across every item, or undefined for a mix (per-100 rules then cannot apply). */
  unit?: 'g' | 'ml';
  energyKcal: number;
  proteinMg: number;
  carbMg: number;
  fatMg: number;
  /** Only when every item states it. */
  sugarMg?: number;
  fibreMg?: number;
}

function compose(items: PublishedFood[]): Composition | undefined {
  if (!items.length) return undefined;
  // A lone food without an amount (a food or catalogue post) is described per 100 of its unit.
  const amounts = items.every((item) => item.amount !== undefined && item.amount > 0)
    ? items.map((item) => item.amount as number)
    : items.length === 1
      ? [100]
      : undefined;
  if (!amounts) return undefined;
  const sum = (pick: (item: PublishedFood) => number) =>
    items.reduce((total, item, index) => total + (pick(item) * amounts[index]) / 100, 0);
  const all = (key: 'sugarMgPer100' | 'fibreMgPer100') =>
    items.every((item) => item[key] != null) ? sum((item) => item[key] as number) : undefined;
  const units = new Set(items.map((item) => item.unit));
  return {
    amount: amounts.reduce((a, b) => a + b, 0),
    unit: units.size === 1 ? items[0].unit : undefined,
    energyKcal: sum((item) => item.energyKcalPer100),
    proteinMg: sum((item) => item.proteinMgPer100),
    carbMg: sum((item) => item.carbMgPer100),
    fatMg: sum((item) => item.fatMgPer100),
    sugarMg: all('sugarMgPer100'),
    fibreMg: all('fibreMgPer100'),
  };
}

function diet(topic: DietTopic, basis: string): PostTopic {
  return { id: `diet:${topic}`, kind: 'diet', label: DIET_LABELS[topic], basis };
}

/** Diet tags for a publication, in `DIET_TOPICS` order. */
export function dietTopics(publication: Pick<FoodPublication, 'kind' | 'items'>): PostTopic[] {
  const c = compose(publication.items);
  if (!c) return [];
  const topics: PostTopic[] = [];
  const shares = macroShares(c);
  if (shares.protein + shares.carbs + shares.fat > 0) {
    if (shares.protein >= 0.2) topics.push(diet('high-protein', 'At least 20% of energy from protein (EU "high protein")'));
    if (shares.carbs < 0.26) topics.push(diet('low-carb', 'Under 26% of energy from carbohydrate'));
  }
  // Per 100 g or ml of what was published: meaningless across a whole day, and impossible
  // across grams and millilitres, which are never converted.
  if (publication.kind !== 'day' && c.unit) {
    const per100 = (value: number) => (value / c.amount) * 100;
    const liquid = c.unit === 'ml';
    const unit = liquid ? '100 ml' : '100 g';
    const fatLimit = liquid ? 1500 : 3000;
    const kcalLimit = liquid ? 20 : 40;
    const sugarLimit = liquid ? 2500 : 5000;
    if (per100(c.fatMg) <= fatLimit) topics.push(diet('low-fat', `At most ${fatLimit / 1000} g fat per ${unit} (EU "low fat")`));
    if (per100(c.energyKcal) <= kcalLimit) topics.push(diet('low-calorie', `At most ${kcalLimit} kcal per ${unit} (EU "low energy")`));
    if (c.sugarMg !== undefined && per100(c.sugarMg) <= sugarLimit) {
      topics.push(diet('low-sugar', `At most ${sugarLimit / 1000} g sugar per ${unit} (EU "low sugar")`));
    }
    if (
      c.fibreMg !== undefined &&
      (per100(c.fibreMg) >= 6000 || (c.energyKcal > 0 && (c.fibreMg / c.energyKcal) * 100 >= 3000))
    ) {
      topics.push(diet('high-fibre', `At least 6 g fibre per ${unit} or 3 g per 100 kcal (EU "high fibre")`));
    }
  }
  return topics;
}

/**
 * `#tags` in a caption: a `#` at the start or after something that is not a letter, digit, `_`,
 * `/`, `&` or `#` (so not inside a word, URL fragment or entity), then 1–50 letters, marks,
 * digits or `_` in any script, with at least one letter. NFC-normalised and lower-cased,
 * deduplicated in order of first appearance, at most `MAX_POST_HASHTAGS`.
 */
export function captionHashtags(caption: string): string[] {
  const found: string[] = [];
  const pattern = /(?:^|[^\p{L}\p{M}\p{N}_/&#])#([\p{L}\p{M}\p{N}_]+)/gu;
  for (const match of caption.normalize('NFC').matchAll(pattern)) {
    const tag = match[1].toLowerCase();
    if (tag.length > MAX_HASHTAG_LENGTH || !/\p{L}/u.test(tag) || found.includes(tag)) continue;
    found.push(tag);
    if (found.length === MAX_POST_HASHTAGS) break;
  }
  return found;
}

/** Every topic of a post: diet tags first, then hashtags. A post without food has hashtags only. */
export function postTopics(post: {
  caption: string;
  publication?: Pick<FoodPublication, 'kind' | 'items'>;
}): PostTopic[] {
  return [
    ...(post.publication ? dietTopics(post.publication) : []),
    ...captionHashtags(post.caption).map((tag) => ({
      id: `tag:${tag}`,
      kind: 'hashtag' as const,
      label: `#${tag}`,
      basis: 'Hashtag in the caption',
    })),
  ];
}
