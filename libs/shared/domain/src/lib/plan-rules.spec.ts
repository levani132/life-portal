import type { PlanRule } from '@life-portal/shared-types';
import { combinePlanRules, describePlanRule, planRuleConflicts, planRuleProblem, planRuleStatus, resolvePlanRule } from './plan-rules';

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
