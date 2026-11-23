import {
  PLAN_RULE_BASES,
  PLAN_RULE_KINDS,
  PLAN_RULE_LIMITS,
  PLAN_RULE_METRICS,
  PLAN_RULE_SCOPES,
  type EntryTotals,
  type PlanRule,
  type PlanRuleInput,
  type PlanRuleMetric,
  type PlanRuleScope,
} from '@life-portal/shared-types';

/**
 * Plan rules (spec 043): "at least 150 g of protein a day", "about 500 kcal at dinner", "1.8 g of
 * protein per kg of target weight", "30% of calories from protein". Stored as the person wrote
 * them; what they come to on a given day, whether the day meets them and how several plans'
 * rules combine is all worked out here, with every input passed in (principles 3 and 5).
 *
 * Units: calories in whole kcal, macros in mg, per kg in kcal or mg per kg, shares in whole percent.
 */

/** kcal in a gram of each macro, for shares. */
const KCAL_PER_G: Record<Exclude<PlanRuleMetric, 'energy'>, number> = { protein: 4, carb: 4, fat: 9 };
const TOTAL_KEY: Record<PlanRuleMetric, keyof EntryTotals> = { energy: 'energyKcal', protein: 'proteinMg', carb: 'carbMg', fat: 'fatMg' };
const DEFAULT_TOLERANCE = 10;

const WORDS: Record<PlanRuleMetric, string> = { energy: 'calories', protein: 'protein', carb: 'carbs', fat: 'fat' };
const SCOPE_WORDS: Record<PlanRuleScope, string> = { day: 'a day', breakfast: 'at breakfast', lunch: 'at lunch', dinner: 'at dinner', snack: 'in snacks' };

/** The largest number each basis accepts, by whether the rule is about calories. */
const MAX: Record<PlanRule['basis'], { energy: number; macro: number }> = {
  amount: { energy: 20_000, macro: 2_000_000 },
  perKg: { energy: 200, macro: 20_000 },
  perKgTarget: { energy: 200, macro: 20_000 },
  share: { energy: 100, macro: 100 },
};

/** Why a rule cannot be saved as sent, or nothing when it can. */
export function planRuleProblem(rule: PlanRuleInput): string | undefined {
  if (!(PLAN_RULE_METRICS as readonly string[]).includes(rule.metric)) return 'Choose what the rule is about.';
  if (!(PLAN_RULE_SCOPES as readonly string[]).includes(rule.scope)) return 'Choose the day or a meal.';
  if (!(PLAN_RULE_KINDS as readonly string[]).includes(rule.kind)) return 'Choose at least, at most, between or about.';
  if (!(PLAN_RULE_BASES as readonly string[]).includes(rule.basis)) return 'Choose an amount, per kg or a share.';
  if (rule.metric === 'energy' && rule.scope === 'day' && rule.basis === 'share') return 'A share of the day’s calories needs a meal.';
  const max = MAX[rule.basis][rule.metric === 'energy' ? 'energy' : 'macro'];
  const ok = (n: number | undefined) => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= max;
  if (rule.kind === 'between') {
    if (!ok(rule.low) || !ok(rule.high)) return 'Give both numbers.';
    if ((rule.low as number) >= (rule.high as number)) return 'The first number must be the smaller.';
  } else if (!ok(rule.value)) return 'Give the number.';
  if (rule.kind === 'about' && rule.tolerancePct !== undefined) {
    if (!Number.isInteger(rule.tolerancePct) || rule.tolerancePct < 1 || rule.tolerancePct > PLAN_RULE_LIMITS.toleranceMax)
      return `The tolerance is 1 to ${PLAN_RULE_LIMITS.toleranceMax}%.`;
  }
  return undefined;
}

/** A number in a rule's unit: "150 g", "1.8 g", "2,000 kcal", "30%". */
function numberText(rule: Pick<PlanRule, 'metric' | 'basis'>, n: number, withUnit = true): string {
  if (rule.basis === 'share') return withUnit ? `${n}%` : String(n);
  if (rule.metric === 'energy') return withUnit ? `${n.toLocaleString('en-GB')} kcal` : n.toLocaleString('en-GB');
  const g = n / 1000;
  const text = Number.isInteger(g) ? g.toLocaleString('en-GB') : g.toLocaleString('en-GB', { maximumFractionDigits: 1 });
  return withUnit ? `${text} g` : text;
}

/** The rule as a sentence: "At least 150 g protein a day", "About 30% of calories from fat at lunch". */
export function describePlanRule(rule: PlanRuleInput): string {
  const lead = { atLeast: 'At least', atMost: 'At most', between: 'Between', about: 'About' }[rule.kind];
  const number =
    rule.kind === 'between'
      ? `${numberText(rule, rule.low ?? 0, false)} and ${numberText(rule, rule.high ?? 0)}`
      : numberText(rule, rule.value ?? 0);
  const where = SCOPE_WORDS[rule.scope];
  const perKg = rule.basis === 'perKg' ? ' per kg' : rule.basis === 'perKgTarget' ? ' per kg of target weight' : '';
  let text: string;
  if (rule.basis === 'share')
    text = rule.metric === 'energy' ? `${lead} ${number} of the day’s calories ${where}` : `${lead} ${number} of calories from ${WORDS[rule.metric]} ${where}`;
  else if (rule.metric === 'energy') text = `${lead} ${number}${perKg} ${where}`;
  else text = `${lead} ${number} ${WORDS[rule.metric]}${perKg} ${where}`;
  if (rule.kind === 'about') text += ` (±${rule.tolerancePct ?? DEFAULT_TOLERANCE}%)`;
  return text;
}

/** What a day's rules are resolved against. Weights in grams. */
export interface RuleContext {
  /** Latest weigh-in on or before the day. */
  weightGrams?: number;
  targetWeightGrams?: number;
  /** The day's calorie target, for shares of the day: the plans' own if they set one, else the app's. */
  dayEnergyKcal?: number;
  /** Whether that calorie target is itself an estimate. */
  dayEnergyEstimated?: boolean;
}

/** A rule turned into numbers in its own unit (kcal, or mg for a macro). */
export interface ResolvedRule {
  metric: PlanRuleMetric;
  scope: PlanRuleScope;
  low?: number;
  high?: number;
  /** For "about": the number aimed at. */
  target?: number;
  /** Rests on an estimate: a weigh-in's weight, or an estimated calorie target. */
  estimated: boolean;
  /** Why it cannot be worked out today: no weigh-in, no target weight. */
  missing?: 'weight' | 'targetWeight';
  /** A share with no calorie target to take it of: checked against what was eaten instead. */
  ofEaten?: boolean;
}

/**
 * What a rule comes to. A share of calories is taken of the day's calorie target (for a macro over
 * the day, or calories at a meal) or of the meal's calories as eaten (a macro at a meal); with no
 * calorie target, of what was eaten that day, and says so.
 */
export function resolvePlanRule(rule: PlanRule, ctx: RuleContext, eaten?: { dayKcal: number; scopeKcal: number }): ResolvedRule {
  const base = { metric: rule.metric, scope: rule.scope };
  let scale = 1;
  let estimated = false;
  let ofEaten = false;
  if (rule.basis === 'perKg' || rule.basis === 'perKgTarget') {
    const weight = rule.basis === 'perKg' ? ctx.weightGrams : ctx.targetWeightGrams;
    if (!weight) return { ...base, estimated: false, missing: rule.basis === 'perKg' ? 'weight' : 'targetWeight' };
    scale = weight / 1000;
    estimated = rule.basis === 'perKg';
  } else if (rule.basis === 'share') {
    // Calories at a meal, or a macro over the day: a share of the day's calories.
    const ofDay = rule.metric === 'energy' || rule.scope === 'day';
    let reference: number | undefined;
    if (ofDay && ctx.dayEnergyKcal) {
      reference = ctx.dayEnergyKcal;
      estimated = !!ctx.dayEnergyEstimated;
    } else {
      reference = ofDay ? eaten?.dayKcal : eaten?.scopeKcal;
      ofEaten = true;
    }
    reference = reference ?? 0;
    // A share is a percent of kcal; a macro's is then turned into mg.
    scale = rule.metric === 'energy' ? reference / 100 : (reference / 100 / KCAL_PER_G[rule.metric]) * 1000;
  }
  const at = (n: number | undefined) => (n === undefined ? undefined : Math.round(n * scale));
  const common = { ...base, estimated, ...(ofEaten ? { ofEaten } : {}) };
  switch (rule.kind) {
    case 'atLeast':
      return { ...common, low: at(rule.value) };
    case 'atMost':
      return { ...common, high: at(rule.value) };
    case 'between':
      return { ...common, low: at(rule.low), high: at(rule.high) };
    case 'about': {
      const target = at(rule.value) as number;
      const spread = (rule.tolerancePct ?? DEFAULT_TOLERANCE) / 100;
      return { ...common, target, low: Math.round(target * (1 - spread)), high: Math.round(target * (1 + spread)) };
    }
  }
}

/** Where an amount stands against resolved limits. */
export type RuleStatus = 'met' | 'under' | 'over';
export function planRuleStatus(rule: Pick<ResolvedRule, 'low' | 'high'>, amount: number): RuleStatus {
  if (rule.low !== undefined && amount < rule.low) return 'under';
  if (rule.high !== undefined && amount > rule.high) return 'over';
  return 'met';
}

/** How much of a metric was eaten in a scope, in the rule's unit. */
export function eatenFor(metric: PlanRuleMetric, totals: EntryTotals): number {
  return totals[TOTAL_KEY[metric]] as number;
}

/** A plan's rule, with which plan it is from. */
export interface SourcedRule {
  rule: PlanRule;
  planId: string;
  planName: string;
}

/** Every followed rule on one metric in one place, combined. */
export interface CombinedRule {
  metric: PlanRuleMetric;
  scope: PlanRuleScope;
  low?: number;
  high?: number;
  target?: number;
  /** The plan whose floor applies, and whose ceiling. */
  lowFrom?: string;
  highFrom?: string;
  estimated: boolean;
  /** A rule here could not be worked out (no weigh-in, no target weight). */
  missing?: 'weight' | 'targetWeight';
  ofEaten?: boolean;
  /** The highest floor is above the lowest ceiling: no amount meets both. */
  conflict: boolean;
  /** Each rule as written, with its plan, for showing where the numbers come from. */
  rules: { text: string; planName: string }[];
}

const SCOPE_ORDER = new Map(PLAN_RULE_SCOPES.map((scope, index) => [scope, index]));
const METRIC_ORDER = new Map(PLAN_RULE_METRICS.map((metric, index) => [metric, index]));

/**
 * Several plans' rules for one day, combined by metric and place: the highest floor and the
 * lowest ceiling apply, each naming its plan; an "about" target survives only when it is the one
 * rule there. Calories over the day are resolved first, because shares of the day are taken of
 * them (else of `ctx.dayEnergyKcal`, the app's own target).
 */
export function combinePlanRules(
  rules: readonly SourcedRule[],
  ctx: RuleContext,
  eaten?: { dayKcal: number; scopeKcal: (scope: PlanRuleScope) => number },
): CombinedRule[] {
  const groups = new Map<string, SourcedRule[]>();
  for (const sourced of rules) {
    const key = `${sourced.rule.metric}:${sourced.rule.scope}`;
    groups.set(key, [...(groups.get(key) ?? []), sourced]);
  }
  const combineGroup = (members: SourcedRule[], context: RuleContext): CombinedRule => {
    const { metric, scope } = members[0].rule;
    const out: CombinedRule = { metric, scope, estimated: false, conflict: false, rules: [] };
    for (const { rule, planName } of members) {
      out.rules.push({ text: describePlanRule(rule), planName });
      const resolved = resolvePlanRule(rule, context, eaten ? { dayKcal: eaten.dayKcal, scopeKcal: eaten.scopeKcal(scope) } : undefined);
      if (resolved.missing) {
        out.missing = resolved.missing;
        continue;
      }
      out.estimated ||= resolved.estimated;
      if (resolved.ofEaten) out.ofEaten = true;
      if (resolved.low !== undefined && (out.low === undefined || resolved.low > out.low)) [out.low, out.lowFrom] = [resolved.low, planName];
      if (resolved.high !== undefined && (out.high === undefined || resolved.high < out.high)) [out.high, out.highFrom] = [resolved.high, planName];
      if (resolved.target !== undefined) out.target = members.length === 1 ? resolved.target : undefined;
    }
    out.conflict = out.low !== undefined && out.high !== undefined && out.low > out.high;
    return out;
  };
  // Calories over the day first: shares of the day are taken of them.
  const dayEnergy = groups.get('energy:day');
  const dayEnergyCombined = dayEnergy ? combineGroup(dayEnergy, ctx) : undefined;
  const planEnergy = dayEnergyCombined ? referenceOf(dayEnergyCombined) : undefined;
  const context: RuleContext =
    planEnergy !== undefined ? { ...ctx, dayEnergyKcal: planEnergy, dayEnergyEstimated: dayEnergyCombined?.estimated ?? false } : ctx;
  return [...groups.values()]
    .map((members) => (members === dayEnergy ? (dayEnergyCombined as CombinedRule) : combineGroup(members, context)))
    .sort((a, b) => (SCOPE_ORDER.get(a.scope) ?? 0) - (SCOPE_ORDER.get(b.scope) ?? 0) || (METRIC_ORDER.get(a.metric) ?? 0) - (METRIC_ORDER.get(b.metric) ?? 0));
}

/** The one number a combined rule aims at: its target, the middle of its range, else its single bound. */
export function referenceOf(rule: Pick<CombinedRule, 'low' | 'high' | 'target'>): number | undefined {
  if (rule.target !== undefined) return rule.target;
  if (rule.low !== undefined && rule.high !== undefined) return Math.round((rule.low + rule.high) / 2);
  return rule.low ?? rule.high;
}

/**
 * Rules of a plan about to be followed that cannot be met together with those already followed,
 * each named with both plans. Rules that need a weight not known yet are left out.
 */
export function planRuleConflicts(
  followed: readonly SourcedRule[],
  next: readonly SourcedRule[],
  ctx: RuleContext,
): { metric: PlanRuleMetric; scope: PlanRuleScope; ours: string; theirs: string; theirPlan: string }[] {
  const found: { metric: PlanRuleMetric; scope: PlanRuleScope; ours: string; theirs: string; theirPlan: string }[] = [];
  for (const mine of next) {
    const a = resolvePlanRule(mine.rule, ctx);
    if (a.missing || a.ofEaten) continue;
    for (const other of followed) {
      if (other.rule.metric !== mine.rule.metric || other.rule.scope !== mine.rule.scope) continue;
      const b = resolvePlanRule(other.rule, ctx);
      if (b.missing || b.ofEaten) continue;
      const low = Math.max(a.low ?? -Infinity, b.low ?? -Infinity);
      const high = Math.min(a.high ?? Infinity, b.high ?? Infinity);
      if (low > high)
        found.push({ metric: mine.rule.metric, scope: mine.rule.scope, ours: describePlanRule(mine.rule), theirs: describePlanRule(other.rule), theirPlan: other.planName });
    }
  }
  return found;
}
