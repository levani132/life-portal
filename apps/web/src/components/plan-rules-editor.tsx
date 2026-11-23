'use client';

import { Plus, Trash2 } from 'lucide-react';
import type { PlanRule, PlanRuleBasis, PlanRuleInput, PlanRuleKind, PlanRuleMetric, PlanRuleScope } from '@life-portal/shared-types';
import { describePlanRule, planRuleProblem } from '@life-portal/shared-domain';
import { Input, Select } from './ui';

/**
 * A rule as the editor holds it (spec 043): numbers as typed, in the units people think in
 * (g, g per kg, %, kcal). `toRuleInput` turns it into what is stored (mg, mg per kg).
 */
export interface RuleDraft {
  key: string;
  id?: string;
  metric: PlanRuleMetric;
  scope: PlanRuleScope;
  kind: PlanRuleKind;
  basis: PlanRuleBasis;
  value: string;
  low: string;
  high: string;
  tolerance: string;
  /** Checked on each food rather than the total. */
  each: boolean;
}

let seq = 0;
const nextKey = () => `r${seq++}`;

/** Grams (and g per kg) are typed; mg are stored. Calories and shares are whole numbers either way. */
const inMg = (rule: Pick<RuleDraft, 'metric' | 'basis'>) => rule.metric !== 'energy' && rule.basis !== 'share';
const parse = (rule: Pick<RuleDraft, 'metric' | 'basis'>, text: string): number | undefined => {
  const n = Number(text.replace(',', '.'));
  if (!text.trim() || !Number.isFinite(n)) return undefined;
  return Math.round(inMg(rule) ? n * 1000 : n);
};
const show = (rule: Pick<RuleDraft, 'metric' | 'basis'>, n: number | undefined) => (n === undefined ? '' : String(inMg(rule) ? n / 1000 : n));

export function ruleDraft(rule: PlanRule): RuleDraft {
  return {
    key: nextKey(),
    id: rule.id,
    metric: rule.metric,
    scope: rule.scope,
    kind: rule.kind,
    basis: rule.basis,
    value: show(rule, rule.value),
    low: show(rule, rule.low),
    high: show(rule, rule.high),
    tolerance: rule.tolerancePct ? String(rule.tolerancePct) : '10',
    each: !!rule.each,
  };
}

export function toRuleInput(draft: RuleDraft): PlanRuleInput {
  return {
    ...(draft.id ? { id: draft.id } : {}),
    metric: draft.metric,
    scope: draft.scope,
    kind: draft.kind,
    basis: draft.basis,
    ...(draft.kind === 'between' ? { low: parse(draft, draft.low), high: parse(draft, draft.high) } : { value: parse(draft, draft.value) }),
    ...(draft.kind === 'about' ? { tolerancePct: Number(draft.tolerance) || 10 } : {}),
    ...(draft.each ? { each: true } : {}),
  };
}

const blank = (patch: Partial<RuleDraft>): RuleDraft => ({
  key: nextKey(),
  metric: 'protein',
  scope: 'day',
  kind: 'atLeast',
  basis: 'amount',
  value: '',
  low: '',
  high: '',
  tolerance: '10',
  each: false,
  ...patch,
});

/** One tap for the rules people write most; each can then be changed like any other. */
const PRESETS: { label: string; rules: Partial<RuleDraft>[] }[] = [
  { label: 'Protein per kg', rules: [{ metric: 'protein', basis: 'perKg', value: '1.8' }] },
  { label: 'Calorie ceiling', rules: [{ metric: 'energy', kind: 'atMost', value: '2000' }] },
  { label: 'Calorie floor', rules: [{ metric: 'energy', value: '1800' }] },
  { label: 'Protein at breakfast', rules: [{ metric: 'protein', scope: 'breakfast', value: '30' }] },
  { label: 'Low-sugar snacks', rules: [{ metric: 'sugar', scope: 'snack', kind: 'atMost', basis: 'per100', value: '10', each: true }] },
  { label: 'No food over 600 kcal', rules: [{ metric: 'energy', kind: 'atMost', value: '600', each: true }] },
  {
    label: '40/30/30 split',
    rules: [
      { metric: 'carb', kind: 'about', basis: 'share', value: '40', tolerance: '5' },
      { metric: 'protein', kind: 'about', basis: 'share', value: '30', tolerance: '5' },
      { metric: 'fat', kind: 'about', basis: 'share', value: '30', tolerance: '5' },
    ],
  },
];

const METRICS: { id: PlanRuleMetric; label: string }[] = [
  { id: 'protein', label: 'protein' },
  { id: 'carb', label: 'carbs' },
  { id: 'fat', label: 'fat' },
  { id: 'energy', label: 'calories' },
  { id: 'fibre', label: 'fibre' },
  { id: 'sugar', label: 'sugar' },
  { id: 'satFat', label: 'saturated fat' },
];
/** Metrics with no daily total: only ever checked on each food. */
const EACH_ONLY: PlanRuleMetric[] = ['sugar', 'satFat'];
const SCOPES: { id: PlanRuleScope; label: string }[] = [
  { id: 'day', label: 'a day' },
  { id: 'breakfast', label: 'at breakfast' },
  { id: 'lunch', label: 'at lunch' },
  { id: 'dinner', label: 'at dinner' },
  { id: 'snack', label: 'in snacks' },
];
const KINDS: { id: PlanRuleKind; label: string }[] = [
  { id: 'atLeast', label: 'At least' },
  { id: 'atMost', label: 'At most' },
  { id: 'between', label: 'Between' },
  { id: 'about', label: 'About' },
];
/** The unit choices, worded for the metric. */
function bases(metric: PlanRuleMetric, scope: PlanRuleScope, each: boolean): { id: PlanRuleBasis; label: string }[] {
  const energy = metric === 'energy';
  if (each)
    return [
      { id: 'amount', label: energy ? 'kcal in it' : 'g in it' },
      { id: 'per100', label: energy ? 'kcal per 100 g' : 'g per 100 g' },
      ...(energy || metric === 'fibre' ? [] : [{ id: 'share' as const, label: '% of its calories' }]),
    ];
  return [
    { id: 'amount', label: energy ? 'kcal' : 'g' },
    { id: 'perKg', label: energy ? 'kcal per kg' : 'g per kg' },
    { id: 'perKgTarget', label: energy ? 'kcal per kg of target' : 'g per kg of target' },
    ...((energy && scope === 'day') || metric === 'fibre' ? [] : [{ id: 'share' as const, label: energy ? '% of the day' : '% of calories' }]),
  ];
}

/**
 * Rules as sentences: "At least [150] [g] [protein] [a day]". Presets add the common ones in one
 * tap. Each row says what it means, or what is wrong with it.
 */
export function PlanRulesEditor({ rules, onChange, max, presets = true }: { rules: RuleDraft[]; onChange: (next: RuleDraft[]) => void; max: number; presets?: boolean }) {
  const set = (key: string, patch: Partial<RuleDraft>) =>
    onChange(
      rules.map((rule) => {
        if (rule.key !== key) return rule;
        const next = { ...rule, ...patch };
        // Sugar and saturated fat have no daily total: rules on them are on each food.
        if (EACH_ONLY.includes(next.metric)) next.each = true;
        // Keep the unit one this kind of rule offers.
        if (!bases(next.metric, next.scope, next.each).some((basis) => basis.id === next.basis)) next.basis = 'amount';
        return next;
      }),
    );
  return (
    <div className="space-y-2">
      {rules.map((rule) => {
        const input = toRuleInput(rule);
        const problem = planRuleProblem(input);
        return (
          <div key={rule.key} className="space-y-1.5 rounded-lg border border-border/70 p-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <Select aria-label="Limit" className="w-auto" value={rule.kind} onChange={(event) => set(rule.key, { kind: event.target.value as PlanRuleKind })}>
                {KINDS.map((kind) => (
                  <option key={kind.id} value={kind.id}>
                    {kind.label}
                  </option>
                ))}
              </Select>
              {rule.kind === 'between' ? (
                <>
                  <Input inputMode="decimal" aria-label="From" className="w-20" value={rule.low} onChange={(event) => set(rule.key, { low: event.target.value })} />
                  <span className="text-sm text-ink-muted">and</span>
                  <Input inputMode="decimal" aria-label="To" className="w-20" value={rule.high} onChange={(event) => set(rule.key, { high: event.target.value })} />
                </>
              ) : (
                <Input inputMode="decimal" aria-label="Number" className="w-24" value={rule.value} onChange={(event) => set(rule.key, { value: event.target.value })} />
              )}
              <Select aria-label="Unit" className="w-auto" value={rule.basis} onChange={(event) => set(rule.key, { basis: event.target.value as PlanRuleBasis })}>
                {bases(rule.metric, rule.scope, rule.each).map((basis) => (
                  <option key={basis.id} value={basis.id}>
                    {basis.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Select aria-label="What" className="w-auto" value={rule.metric} onChange={(event) => set(rule.key, { metric: event.target.value as PlanRuleMetric })}>
                {METRICS.map((metric) => (
                  <option key={metric.id} value={metric.id}>
                    {metric.label}
                  </option>
                ))}
              </Select>
              <Select
                aria-label="Applies to"
                className="w-auto"
                value={rule.each ? 'each' : 'total'}
                onChange={(event) => set(rule.key, { each: event.target.value === 'each' })}
              >
                {!EACH_ONLY.includes(rule.metric) && <option value="total">in total</option>}
                <option value="each">in each food</option>
              </Select>
              <Select aria-label="Where" className="w-auto" value={rule.scope} onChange={(event) => set(rule.key, { scope: event.target.value as PlanRuleScope })}>
                {SCOPES.map((scope) => (
                  <option key={scope.id} value={scope.id}>
                    {rule.each && scope.id === 'day' ? 'at any meal' : scope.label}
                  </option>
                ))}
              </Select>
              {rule.kind === 'about' && (
                <Select aria-label="Tolerance" className="w-auto" value={rule.tolerance} onChange={(event) => set(rule.key, { tolerance: event.target.value })}>
                  {['5', '10', '15', '20', '25'].map((pct) => (
                    <option key={pct} value={pct}>
                      ±{pct}%
                    </option>
                  ))}
                </Select>
              )}
              <button type="button" className="btn-ghost ml-auto shrink-0" aria-label="Remove this rule" onClick={() => onChange(rules.filter((each) => each.key !== rule.key))}>
                <Trash2 size={16} />
              </button>
            </div>
            <p className={`text-xs ${problem ? 'text-warning' : 'text-ink-muted'}`}>{problem ?? describePlanRule(input)}</p>
          </div>
        );
      })}
      {rules.length < max && (
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" className="btn-ghost" onClick={() => onChange([...rules, blank({})])}>
            <Plus size={16} /> Rule
          </button>
          {presets &&
            PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                className="rounded-full border border-border px-2.5 py-1 text-xs text-ink-muted hover:text-ink"
                onClick={() => onChange([...rules, ...preset.rules.map((patch) => blank(patch))].slice(0, max))}
              >
                + {preset.label}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
