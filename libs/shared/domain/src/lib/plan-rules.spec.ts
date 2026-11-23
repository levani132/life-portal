import type { PlanRule } from '@life-portal/shared-types';
import { applyPlanTargets, checkFoodRules, combinePlanRules, describePlanRule, planRuleConflicts, planRuleProblem, planRuleStatus, resolvePlanRule } from './plan-rules';

const rule = (over: Partial<PlanRule>): PlanRule => ({ id: 'r', metric: 'protein', scope: 'day', kind: 'atLeast', basis: 'amount', value: 150_000, ...over });

describe('planRuleProblem (spec 043)', () => {
  it('accepts the simple ones and refuses what cannot mean anything', () => {
    expect(planRuleProblem(rule({}))).toBeUndefined();
    expect(planRuleProblem(rule({ kind: 'between', value: undefined, low: 100_000, high: 150_000 }))).toBeUndefined();
    expect(planRuleProblem(rule({ kind: 'between', value: undefined, low: 150_000, high: 100_000 }))).toBe('The first number must be the smaller.');
    expect(planRuleProblem(rule({ value: 0 }))).toBe('Give the number.');
    expect(planRuleProblem(rule({ value: 1.5 }))).toBe('Give the number.');
    expect(planRuleProblem(rule({ basis: 'share', value: 120 }))).toBe('Give the number.');
    expect(planRuleProblem(rule({ metric: 'energy', basis: 'share', value: 25 }))).toBe('A share of the day’s calories needs a meal.');
    expect(planRuleProblem(rule({ kind: 'about', tolerancePct: 80 }))).toBe('The tolerance is 1 to 50%.');
  });
});

describe('describePlanRule', () => {
  it('reads as a sentence', () => {
    expect(describePlanRule(rule({}))).toBe('At least 150 g protein a day');
    expect(describePlanRule(rule({ metric: 'energy', kind: 'atMost', value: 2000 }))).toBe('At most 2,000 kcal a day');
    expect(describePlanRule(rule({ scope: 'breakfast', value: 30_000 }))).toBe('At least 30 g protein at breakfast');
    expect(describePlanRule(rule({ basis: 'perKgTarget', value: 1800 }))).toBe('At least 1.8 g protein per kg of target weight a day');
    expect(describePlanRule(rule({ basis: 'share', kind: 'about', value: 30 }))).toBe('About 30% of calories from protein a day (±10%)');
    expect(describePlanRule(rule({ metric: 'energy', scope: 'dinner', basis: 'share', value: 25 }))).toBe('At least 25% of the day’s calories at dinner');
    expect(describePlanRule(rule({ kind: 'between', low: 100_000, high: 150_000 }))).toBe('Between 100 and 150 g protein a day');
  });
});

describe('resolvePlanRule', () => {
  it('turns per kg into amounts from the current or the target weight, and says when one is missing', () => {
    expect(resolvePlanRule(rule({ basis: 'perKg', value: 2000 }), { weightGrams: 80_000 })).toMatchObject({ low: 160_000, estimated: true });
    expect(resolvePlanRule(rule({ basis: 'perKgTarget', value: 2000 }), { weightGrams: 80_000, targetWeightGrams: 75_000 })).toMatchObject({ low: 150_000, estimated: false });
    expect(resolvePlanRule(rule({ basis: 'perKgTarget', value: 2000 }), { weightGrams: 80_000 })).toMatchObject({ missing: 'targetWeight' });
  });
  it('takes a share of the day’s calories, or of what was eaten when there is no target', () => {
    // 30% of 2,000 kcal from protein = 600 kcal = 150 g.
    expect(resolvePlanRule(rule({ basis: 'share', value: 30 }), { dayEnergyKcal: 2000 })).toMatchObject({ low: 150_000 });
    expect(resolvePlanRule(rule({ metric: 'energy', scope: 'breakfast', basis: 'share', kind: 'atMost', value: 25 }), { dayEnergyKcal: 2000 })).toMatchObject({ high: 500 });
    expect(resolvePlanRule(rule({ basis: 'share', value: 30 }), {}, { dayKcal: 1600, scopeKcal: 1600 })).toMatchObject({ low: 120_000, ofEaten: true });
    // A macro's share at a meal is of that meal's calories.
    expect(resolvePlanRule(rule({ scope: 'lunch', metric: 'fat', basis: 'share', kind: 'atMost', value: 30 }), { dayEnergyKcal: 2000 }, { dayKcal: 1500, scopeKcal: 900 })).toMatchObject({ high: 30_000 });
  });
  it('gives an "about" its target and both edges', () => {
    expect(resolvePlanRule(rule({ metric: 'energy', scope: 'dinner', kind: 'about', value: 500 }), {})).toEqual({ metric: 'energy', scope: 'dinner', target: 500, low: 450, high: 550, estimated: false });
  });
});

describe('planRuleStatus', () => {
  it('is under, met or over', () => {
    expect([planRuleStatus({ low: 10 }, 5), planRuleStatus({ low: 10, high: 20 }, 15), planRuleStatus({ high: 20 }, 21)]).toEqual(['under', 'met', 'over']);
  });
});

describe('combinePlanRules', () => {
  const sourced = (planName: string, over: Partial<PlanRule>) => ({ planId: planName, planName, rule: rule(over) });
  it('keeps the highest floor and the lowest ceiling, naming the plan each came from', () => {
    const combined = combinePlanRules(
      [sourced('A', { value: 120_000 }), sourced('B', { value: 150_000 }), sourced('C', { kind: 'atMost', value: 200_000 }), sourced('D', { scope: 'breakfast', value: 30_000 })],
      {},
    );
    expect(combined.map((each) => [each.scope, each.low, each.lowFrom, each.high, each.highFrom, each.conflict])).toEqual([
      ['day', 150_000, 'B', 200_000, 'C', false],
      ['breakfast', 30_000, 'D', undefined, undefined, false],
    ]);
  });
  it('takes shares of the plans’ own daily calories before the app’s', () => {
    const combined = combinePlanRules([sourced('A', { metric: 'energy', kind: 'about', value: 1800 }), sourced('B', { basis: 'share', value: 30 })], { dayEnergyKcal: 2400 });
    expect(combined.find((each) => each.metric === 'protein')?.low).toBe(135_000);
  });
  it('marks rules that cannot both be met', () => {
    const combined = combinePlanRules([sourced('Low', { metric: 'energy', kind: 'atMost', value: 1000 }), sourced('High', { metric: 'energy', value: 2000 })], {});
    expect(combined[0]).toMatchObject({ low: 2000, high: 1000, conflict: true });
  });
});

describe('planRuleConflicts', () => {
  it('names the rules of a new plan that clash with those followed', () => {
    const followed = [{ planId: 'a', planName: 'Cut', rule: rule({ metric: 'energy', kind: 'atMost', value: 1000 }) }];
    const next = [
      { planId: 'b', planName: 'Bulk', rule: rule({ metric: 'energy', value: 2000 }) },
      { planId: 'b', planName: 'Bulk', rule: rule({}) },
    ];
    expect(planRuleConflicts(followed, next, {})).toEqual([
      { metric: 'energy', scope: 'day', ours: 'At least 2,000 kcal a day', theirs: 'At most 1,000 kcal a day', theirPlan: 'Cut' },
    ]);
  });
});

describe('planRuleConflicts with weights', () => {
  it('compares per-kg rules once a weight is known, and skips them without one', () => {
    const followed = [{ planId: 'a', planName: 'Low protein', rule: rule({ kind: 'atMost', value: 100_000 }) }];
    const next = [{ planId: 'b', planName: 'Per kg', rule: rule({ basis: 'perKg', value: 2000 }) }];
    expect(planRuleConflicts(followed, next, { weightGrams: 80_000 })).toHaveLength(1);
    expect(planRuleConflicts(followed, next, { weightGrams: 45_000 })).toHaveLength(0);
    expect(planRuleConflicts(followed, next, {})).toHaveLength(0);
  });
});

describe('applyPlanTargets (spec 043)', () => {
  const app = {
    available: true,
    missingInputs: [],
    energyKcal: { value: 2400, basis: 'app' },
    proteinG: { value: 160, basis: 'app' },
    fatG: { value: 70, basis: 'app' },
    carbG: { value: 282, basis: 'app' },
  };
  const sourced = (planName: string, over: Partial<PlanRule>) => ({ planId: planName, planName, rule: rule(over) });
  it('leaves the app’s targets alone with no daily rule', () => {
    expect(applyPlanTargets(app, combinePlanRules([sourced('A', { scope: 'breakfast', value: 30_000 })], {}))).toBe(app);
  });
  it('replaces what a plan sets, works carbs out as the rest, and keeps the app’s numbers', () => {
    const out = applyPlanTargets(app, combinePlanRules([sourced('Cut', { metric: 'energy', kind: 'atMost', value: 2000 }), sourced('Protein', { value: 180_000 })], {}));
    expect(out.energyKcal).toEqual({ value: 2000, recorded: true });
    expect(out.proteinG).toEqual({ value: 180, recorded: true });
    expect(out.fatG).toEqual(app.fatG);
    // 2,000 − 4 × 180 − 9 × 70 = 650 kcal = 162.5 g.
    expect(out.carbG?.value).toBe(163);
    expect(out.plan).toMatchObject({
      rules: [
        { metric: 'energy', high: 2000, planNames: ['Cut'], conflict: false },
        { metric: 'protein', low: 180, planNames: ['Protein'] },
      ],
      app: { energyKcal: 2400, proteinG: 160, fatG: 70, carbG: 282 },
      carbFromRest: true,
    });
  });
  it('labels a number worked out from a weigh-in as an estimate', () => {
    const out = applyPlanTargets(app, combinePlanRules([sourced('Per kg', { basis: 'perKg', value: 2000 })], { weightGrams: 80_000 }));
    expect(out.proteinG).toMatchObject({ value: 160, basis: expect.stringContaining('Per kg') });
  });
  it('makes targets available from plans even when the app has too little to go on', () => {
    const out = applyPlanTargets({ available: false, missingInputs: ['sex'] }, combinePlanRules([sourced('A', { metric: 'energy', kind: 'about', value: 1800 })], {}));
    expect([out.available, out.energyKcal?.value]).toEqual([true, 1800]);
  });
});

describe('rules on each food (spec 043, slice 4)', () => {
  const each = (over: Partial<PlanRule>) => rule({ each: true, ...over });
  const cereal = { energyKcalPer100: 380, proteinMgPer100: 8000, fatMgPer100: 3000, carbMgPer100: 80_000, sugarMgPer100: 22_000 };
  const sourced = (over: Partial<PlanRule>) => ({ planId: 'p', planName: 'Clean', rule: each(over) });
  it('accepts amounts, per 100 g and shares, and refuses what cannot apply to one food', () => {
    expect(planRuleProblem(each({ metric: 'sugar', scope: 'snack', kind: 'atMost', basis: 'per100', value: 10_000 }))).toBeUndefined();
    expect(planRuleProblem(each({ metric: 'energy', kind: 'atMost', value: 600 }))).toBeUndefined();
    expect(planRuleProblem(each({ basis: 'share', value: 30 }))).toBeUndefined();
    expect(planRuleProblem(each({ basis: 'perKg', value: 1000 }))).toBe('A rule on each food is an amount, per 100 g or a share.');
    expect(planRuleProblem(each({ metric: 'energy', basis: 'share', value: 30 }))).toMatch(/share of calories/);
    expect(planRuleProblem(rule({ metric: 'sugar', kind: 'atMost', value: 30_000 }))).toBe('Sugar and saturated fat are checked on each food.');
    expect(planRuleProblem(rule({ basis: 'per100', value: 10_000 }))).toBe('Per 100 g is for a rule on each food.');
  });
  it('reads as a sentence about each food', () => {
    expect(describePlanRule(each({ metric: 'sugar', scope: 'snack', kind: 'atMost', basis: 'per100', value: 10_000 }))).toBe('Each food in snacks: at most 10 g sugar per 100 g');
    expect(describePlanRule(each({ metric: 'energy', kind: 'atMost', value: 600 }))).toBe('Each food: at most 600 kcal');
    expect(describePlanRule(each({ basis: 'share', value: 30 }))).toBe('Each food: at least 30% of its calories from protein');
  });
  it('checks a food at the meal it applies to, and never counts towards totals', () => {
    const rules = [
      sourced({ metric: 'sugar', scope: 'snack', kind: 'atMost', basis: 'per100', value: 10_000 }),
      sourced({ metric: 'energy', kind: 'atMost', value: 600 }),
      sourced({ basis: 'share', value: 30 }),
    ];
    expect(checkFoodRules(rules, cereal, 'snack', 100).map((check) => [check.status, check.value])).toEqual([
      ['over', 22_000],
      ['met', 380],
      // 8 g of protein is 32 of 380 kcal: 8%.
      ['under', 8],
    ]);
    expect(checkFoodRules(rules, cereal, 'lunch').map((check) => check.status)).toEqual(['unknown', 'under']);
    expect(checkFoodRules(rules, { ...cereal, sugarMgPer100: undefined }, 'snack', 100)[0].status).toBe('unknown');
    expect(combinePlanRules(rules, {})).toEqual([]);
  });
});
