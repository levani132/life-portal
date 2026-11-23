'use client';

import Link from 'next/link';
import { CalendarCheck, Pencil, Plus, Share2, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  MEAL_PLAN_LIMITS,
  MEAL_PLAN_OPTIONS_MAX,
  MEAL_SLOTS,
  PLAN_RULE_LIMITS,
  type ActiveMealPlan,
  type ActivePlanLine,
  type FoodPost,
  type FoodWithUsage,
  type MealPlan,
  type MealEntry,
  type MealPlanInput,
  type MealSlot,
  type EntryTotals,
  type NutritionProfile,
  type NutritionTargets,
  type PlanRule,
  type PlanRuleMetric,
  type PostImportPreview,
  type PostImportResult,
  type Programme,
  type TrainingCopyResult,
  type SavedMeal,
} from '@life-portal/shared-types';
import {
  PLAN_ANY_TIME,
  combinePlanRules,
  copyNeedsPlanChoice,
  describePlanRule,
  eatenFor,
  matchPlanDay,
  mealPlanProblem,
  mgToG,
  planLineSlots,
  planRuleConflicts,
  planRuleStatus,
  planSlotsLabel,
  referenceOf,
  type CombinedRule,
  type FoodRuleCheck,
  type RuleContext,
  type RuleStatus,
} from '@life-portal/shared-domain';
import { MACRO_COLORS } from '../lib/macro-colors';
import { api } from '../lib/api';
import { revalidate, useAction, useApi } from '../lib/hooks';
import { actingPageId } from '../lib/identity';
import { mealContextNow } from '../lib/local-day';
import { newPostHref } from '../lib/new-post';
import { FoodCombobox } from './food-combobox';
import { PlanRulesEditor, ruleDraft, toRuleInput, type RuleDraft } from './plan-rules-editor';
import { ErrorNote, Field, Input, Modal, Select, Spinner, Textarea } from './ui';

const PLANS_KEY = '/nutrition/meal-plans';
const FOLLOWING_KEY = `${PLANS_KEY}/following`;
const slotLabel = (slot: MealSlot) => slot.charAt(0).toUpperCase() + slot.slice(1);
/** A line's meals as a save sends them: the first as `slot`, all of them only when there is a choice. */
const lineSlotsInput = (slots: MealSlot[]) => ({ slot: slots[0] ?? 'breakfast', ...(slots.length > 1 ? { slots } : {}) });
/** Everything a change to plans or to what is logged from one can alter. */
const refreshPlans = () => Promise.all([revalidate(PLANS_KEY), revalidate('/nutrition?'), revalidate('/dashboard')]);

/** Every rule a plan has: its own and each day's. */
export const allPlanRules = (plan: Pick<MealPlan, 'rules' | 'days'>): PlanRule[] => [...(plan.rules ?? []), ...plan.days.flatMap((day) => day.rules ?? [])];

/**
 * Before following a plan (spec 043): rules of it that cannot be met together with those of plans
 * already followed are named, and the person chooses. Following several plans is the normal case;
 * this only speaks up when two say opposite things.
 */
export async function okToFollow(name: string, rules: readonly PlanRule[], planId?: string): Promise<boolean> {
  if (!rules.length) return true;
  const today = mealContextNow().day;
  // The weights and the calorie target let per-kg rules and shares be compared too.
  const [{ following }, { profile, targets }] = await Promise.all([
    api.get<{ following: ActiveMealPlan[] }>(`${FOLLOWING_KEY}?today=${today}`),
    api.get<{ profile: NutritionProfile; targets: NutritionTargets }>(`/nutrition/profile?today=${today}`),
  ]);
  const followed = following.filter((plan) => plan.planId !== planId).flatMap((plan) => plan.rules.map((rule) => ({ rule, planId: plan.planId, planName: plan.name })));
  const ctx: RuleContext = {
    weightGrams: targets.weightGrams,
    targetWeightGrams: profile.targetWeightGrams,
    // The app's own calories, not those of plans already followed: shares are compared on one base.
    dayEnergyKcal: targets.plan?.app.energyKcal ?? targets.energyKcal?.value,
  };
  const clashes = planRuleConflicts(followed, rules.map((rule) => ({ rule, planId: planId ?? 'new', planName: name })), ctx);
  if (!clashes.length) return true;
  return window.confirm(
    `${name} cannot be met together with a plan you follow:\n\n${clashes.map((clash) => `• ${clash.ours}, but ${clash.theirPlan} says: ${clash.theirs.toLowerCase()}`).join('\n')}\n\nFollow it anyway? Both will show, and the one not met will say so.`,
  );
}

/** Starts following a plan, after the conflict check. False when the person said no. */
export async function followPlan(plan: { id: string; name: string; rules: PlanRule[]; days: MealPlan['days'] }): Promise<boolean> {
  if (!(await okToFollow(plan.name, allPlanRules(plan), plan.id))) return false;
  await api.put(`${PLANS_KEY}/${plan.id}/follow`, { today: mealContextNow().day });
  return true;
}
export const unfollowPlan = (planId: string) => api.delete(`${PLANS_KEY}/${planId}/follow?today=${mealContextNow().day}`);

/** The plans followed, as they apply to the calendar day on screen. A page has no diary, so none. */
export function useFollowedPlans(today: string | null, day: string | null): ActiveMealPlan[] {
  const key = today && day && !actingPageId() ? `${FOLLOWING_KEY}?today=${today}&day=${day}` : null;
  return useApi<{ following: ActiveMealPlan[] }>(key).data?.following ?? [];
}

export interface PlannedItem {
  plan: ActiveMealPlan;
  line: ActivePlanLine;
}

/**
 * What the diary on screen says about the followed plans: which meals stand for which lines (each
 * plan on its own, so two plans asking for the same food are both met by it), the lines still open
 * at each meal, and every rule combined.
 */
export function plansOnDay(plans: readonly ActiveMealPlan[], entries: readonly MealEntry[], ctx: RuleContext, totals: { day: EntryTotals; slot: (slot: MealSlot) => EntryTotals }) {
  const named = entries.map((entry) => ({ ...entry, name: entry.facts.name }));
  const states = plans.map((plan) => ({ plan, match: matchPlanDay(plan.day.lines, named) }));
  const marks = new Set(states.flatMap((state) => [...state.match.values()].flat()));
  const rules = combinePlanRules(
    plans.flatMap((plan) => plan.rules.map((rule) => ({ rule, planId: plan.planId, planName: plan.name }))),
    ctx,
    { dayKcal: totals.day.energyKcal, scopeKcal: (scope) => (scope === 'day' ? totals.day : totals.slot(scope)).energyKcal },
  );
  return {
    states,
    marks,
    /** Lines not eaten yet, each listed at every meal it may be eaten at. */
    openAt: (slot: MealSlot): PlannedItem[] =>
      states.flatMap(({ plan, match }) => plan.day.lines.filter((line) => !match.has(line.id) && (!line.missing || line.options?.some((option) => !option.missing)) && planLineSlots(line).includes(slot)).map((line) => ({ plan, line }))),
    /** Combined rules for the whole day, and for one meal. */
    dayRules: rules.filter((rule) => rule.scope === 'day'),
    rulesAt: (slot: MealSlot) => rules.filter((rule) => rule.scope === slot),
  };
}

const logPlanned = (plan: ActiveMealPlan, day: string, lines: ActivePlanLine[], slot?: MealSlot, choice = 0) =>
  api.post(`${PLANS_KEY}/${plan.planId}/days/${plan.day.id}/log`, { day, entryIds: lines.map((line) => line.id), ...(slot ? { slot } : {}), ...(choice ? { choice } : {}) });

/** A combined rule's number in display units: kcal, or g for a macro. */
const shown = (metric: PlanRuleMetric, n: number) => (metric === 'energy' ? Math.round(n) : mgToG(n));
/** The limit, short: "≥ 150", "≤ 2,000", "120–150", "≈ 500". */
export function limitText(rule: CombinedRule): string {
  const f = (n: number) => shown(rule.metric, n).toLocaleString('en-GB');
  if (rule.target !== undefined) return `≈ ${f(rule.target)}`;
  if (rule.low !== undefined && rule.high !== undefined) return rule.conflict ? `≥ ${f(rule.low)} and ≤ ${f(rule.high)}` : `${f(rule.low)}–${f(rule.high)}`;
  if (rule.low !== undefined) return `≥ ${f(rule.low)}`;
  if (rule.high !== undefined) return `≤ ${f(rule.high)}`;
  return '';
}
/** Which plans a combined rule's numbers come from. */
export const ruleSources = (rule: CombinedRule) => [...new Set([rule.lowFrom, rule.highFrom].filter(Boolean))].join(' and ') || rule.rules[0]?.planName || '';

const METRIC_COLOR: Record<PlanRuleMetric, string> = {
  energy: MACRO_COLORS.kcal,
  protein: MACRO_COLORS.protein,
  carb: MACRO_COLORS.carbs,
  fat: MACRO_COLORS.fat,
  fibre: 'rgb(var(--fresh-solid))',
  sugar: 'rgb(var(--special-solid))',
  satFat: 'rgb(var(--warning-solid))',
};
const METRIC_LABEL: Record<PlanRuleMetric, string> = { energy: 'Calories', protein: 'Protein', carb: 'Carbs', fat: 'Fat', fibre: 'Fibre', sugar: 'Sugar', satFat: 'Saturated fat' };
const METRIC_UNIT: Record<PlanRuleMetric, string> = { energy: 'kcal', protein: 'g', carb: 'g', fat: 'g', fibre: 'g', sugar: 'g', satFat: 'g' };

/** A rule's status in words and colour, for the eaten amount. */
export function ruleState(rule: CombinedRule, eaten: number): { status: RuleStatus | 'conflict' | 'unknown'; tone: string } {
  if (rule.conflict) return { status: 'conflict', tone: 'text-danger' };
  if (rule.low === undefined && rule.high === undefined) return { status: 'unknown', tone: 'text-ink-faint' };
  const status = planRuleStatus(rule, eaten);
  return { status, tone: status === 'met' ? 'text-success' : status === 'over' ? 'text-danger' : 'text-ink-muted' };
}

/**
 * A meal's rules, under its header (spec 043): each as a small bar in its macro's colour, filled
 * by what this meal has, with the limit and where it stands.
 */
export function MealRules({ rules, totals }: { rules: readonly CombinedRule[]; totals: EntryTotals }) {
  if (!rules.length) return null;
  return (
    <ul className="flex flex-wrap gap-1.5 px-2.5 pb-2 sm:px-4" aria-label="Plan rules for this meal">
      {rules.map((rule) => {
        const eaten = eatenFor(rule.metric, totals);
        const { status, tone } = ruleState(rule, eaten);
        const goal = referenceOf(rule) ?? 0;
        const fill = goal > 0 ? Math.min(100, Math.round((eaten / goal) * 100)) : 0;
        return (
          <li
            key={`${rule.metric}`}
            className="min-w-[8.5rem] flex-1 rounded-lg border border-border/70 bg-surface px-2 py-1.5"
            title={rule.rules.map((each) => `${each.text} (${each.planName})`).join('\n')}
          >
            <div className="flex items-baseline justify-between gap-2 text-[11px]">
              <span className="font-semibold" style={{ color: METRIC_COLOR[rule.metric] }}>
                {METRIC_LABEL[rule.metric]} {limitText(rule)}
                {rule.missing ? '' : ` ${METRIC_UNIT[rule.metric]}`}
              </span>
              <span className={`tabular font-medium ${tone}`}>
                {status === 'met' ? '✓ ' : ''}
                {shown(rule.metric, eaten).toLocaleString('en-GB')}
              </span>
            </div>
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-border/60">
              <div className="h-full rounded-full" style={{ width: `${fill}%`, background: METRIC_COLOR[rule.metric], opacity: status === 'over' ? 0.6 : 1 }} />
            </div>
            {rule.missing && <p className="mt-0.5 text-[10px] text-ink-faint">Needs your {rule.missing === 'weight' ? 'weight' : 'target weight'} (Food → You)</p>}
            {rule.conflict && <p className="mt-0.5 text-[10px] text-danger">Your plans disagree here</p>}
          </li>
        );
      })}
    </ul>
  );
}

/** Who recommended a plan saved from a post, read through the post (so its audience still applies). */
function PlanSourceLine({ postId }: { postId: string }) {
  const post = useApi<FoodPost>(`/posts/${postId}`, { shouldRetryOnError: false });
  if (post.error) return <p className="text-xs text-ink-faint">Saved from a post that is no longer available.</p>;
  if (!post.data) return null;
  const author = post.data.author;
  return (
    <p className="text-xs text-ink-muted">
      Recommended by{' '}
      <Link href={`/posts/${postId}`} className="font-medium text-accent">
        {author.displayName}
      </Link>
      {author.isPage ? ' (page)' : ''}
    </p>
  );
}

/**
 * The plans followed, above the day's meals (spec 043): one chip each, opening its details: who
 * recommended it, which plan day this is (with a picker), its rules, how much of its food is eaten,
 * the last seven days, and Stop following. The rules themselves show on the tiles and in the meals.
 */
export function FollowingStrip({ plans, entries, day, onChanged }: { plans: readonly ActiveMealPlan[]; entries: readonly MealEntry[]; day: string; onChanged: () => void }) {
  const action = useAction();
  const [open, setOpen] = useState<string | null>(null);
  if (!plans.length) return null;
  const run = (work: () => Promise<unknown>) =>
    action.run(
      async () => {
        await work();
        await refreshPlans();
        onChanged();
      },
      { revalidate: false },
    );
  const named = entries.map((entry) => ({ ...entry, name: entry.facts.name }));
  const current = plans.find((plan) => plan.planId === open);
  return (
    <section className="card p-3" aria-label="Plans you follow">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
          <CalendarCheck size={13} aria-hidden /> Following
        </span>
        {plans.map((plan) => (
          <button
            key={plan.planId}
            type="button"
            aria-expanded={open === plan.planId}
            onClick={() => setOpen(open === plan.planId ? null : plan.planId)}
            className={`max-w-full truncate rounded-full border px-2.5 py-1 text-xs font-medium ${open === plan.planId ? 'border-transparent bg-accent-solid text-on-accent' : 'border-border text-ink'}`}
          >
            {plan.name}
          </button>
        ))}
      </div>
      {current && (() => {
        const match = matchPlanDay(current.day.lines, named);
        const counted = current.day.lines.filter((line) => !line.missing);
        const left = counted.filter((line) => !match.has(line.id));
        return (
          <div className="mt-3 space-y-2 border-t border-border pt-3">
            {current.source && <PlanSourceLine postId={current.source.postId} />}
            {current.days.length > 1 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-ink-muted">Today is</span>
                <Select
                  aria-label={`Which day of ${current.name} this is`}
                  className="w-auto max-w-[12rem]"
                  value={current.day.id}
                  disabled={action.pending}
                  onChange={(event) => void run(() => api.put(`${PLANS_KEY}/${current.planId}/day`, { day, dayId: event.target.value }))}
                >
                  {current.days.map((each) => (
                    <option key={each.id} value={each.id}>
                      {each.name}
                    </option>
                  ))}
                </Select>
              </div>
            )}
            {current.rules.length > 0 && (
              <ul className="space-y-0.5 text-xs text-ink-muted">
                {current.rules.map((rule) => (
                  <li key={rule.id}>• {describePlanRule(rule)}</li>
                ))}
              </ul>
            )}
            {counted.length > 0 && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-ink-muted">
                    {counted.length - left.length} of {counted.length} planned foods eaten
                  </span>
                  {left.length > 0 && (
                    <button type="button" className="text-xs font-medium text-accent" disabled={action.pending} onClick={() => void run(() => logPlanned(current, day, left))}>
                      Log the rest
                    </button>
                  )}
                </div>
                {/* The last seven days, each as how much of its plan day was eaten. */}
                <ol className="flex items-end gap-1.5" aria-label="The last seven days">
                  {current.recent.map((each) => {
                    const share = each.planned ? each.followed / each.planned : 0;
                    return (
                      <li key={each.day} className="flex flex-1 flex-col items-center gap-1" title={`${each.day} · ${each.dayName}: ${each.followed} of ${each.planned} eaten`}>
                        <span className="flex h-6 w-full items-end overflow-hidden rounded bg-border/60">
                          <span className={`w-full rounded ${share >= 0.8 ? 'bg-success-solid' : share > 0 ? 'bg-accent-solid' : ''}`} style={{ height: `${Math.round(share * 100)}%` }} />
                        </span>
                        <span className={`text-[10px] ${each.day === day ? 'font-bold text-ink' : 'text-ink-faint'}`}>
                          {new Date(`${each.day}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'narrow' })}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              </>
            )}
            {action.error && <ErrorNote message={action.error} />}
            <div className="flex justify-end">
              <button
                type="button"
                className="text-[11px] text-ink-faint underline"
                disabled={action.pending}
                onClick={() => {
                  if (window.confirm(`Stop following ${current.name}? It stays in your meal plans, to follow again.`)) {
                    setOpen(null);
                    void run(() => unfollowPlan(current.planId));
                  }
                }}
              >
                Stop following
              </button>
            </div>
          </div>
        );
      })()}
    </section>
  );
}

/**
 * A meal's planned lines that are not eaten yet, under what was eaten (spec 042). Log puts the
 * line into this meal of the day on screen, frozen at today's numbers like any meal.
 */
export function PlannedLines({ items, slot, day, onChanged }: { items: PlannedItem[]; slot: MealSlot; day: string; onChanged: () => void }) {
  const action = useAction();
  const [busy, setBusy] = useState<string | null>(null);
  if (!items.length) return null;
  const log = ({ plan, line }: PlannedItem, choice: number) => {
    setBusy(`${line.id}:${choice}`);
    void action
      .run(
        async () => {
          await logPlanned(plan, day, [line], slot, choice);
          await refreshPlans();
          onChanged();
        },
        { revalidate: false },
      )
      .finally(() => setBusy(null));
  };
  const amountText = (choice: { amount?: number; unit?: string }) => (choice.amount ? `${choice.amount} ${choice.unit ?? ''} · ` : '');
  const logButton = (item: PlannedItem, choice: number, name: string, disabled = false) => (
    <button type="button" className="btn-ghost shrink-0 border border-border px-3" disabled={action.pending || disabled} aria-label={`Log ${name}`} onClick={() => log(item, choice)}>
      {busy === `${item.line.id}:${choice}` ? '…' : 'Log'}
    </button>
  );
  return (
    <ul className="space-y-1 px-1.5 pb-1.5 sm:px-4 sm:pb-3" aria-label="Planned">
      {items.map((item) => {
        const { line } = item;
        const slots = planLineSlots(line);
        return (
          <li key={`${item.plan.planId}:${line.id}`} className="rounded-xl border border-dashed border-border px-2.5 py-2 text-[15px] leading-snug">
            <div className="flex items-center gap-2">
              <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-lg text-ink-faint">
                <CalendarCheck size={18} aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-ink-muted">{line.name}</p>
                <p className="text-[13px] leading-snug text-ink-faint">
                  Planned{slots.length > 1 ? ` · ${planSlotsLabel(slots).toLowerCase()}` : ''} · {amountText(line)}
                  {line.totals.energyKcal} kcal · P {mgToG(line.totals.proteinMg)} g
                </p>
              </div>
              {logButton(item, 0, line.name, line.missing)}
            </div>
            {/* Spec 043: or one of these instead. Any of them meets the line. */}
            {line.options?.map((option, index) => (
              <div key={index} className="mt-1.5 flex items-center gap-2 border-t border-dashed border-border/70 pt-1.5">
                <span className="w-[38px] shrink-0 text-center text-[11px] font-semibold uppercase text-accent">or</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-ink-muted">{option.name}</p>
                  <p className="text-[13px] leading-snug text-ink-faint">
                    {amountText(option)}
                    {option.missing ? 'no numbers' : `${option.totals.energyKcal} kcal · P ${mgToG(option.totals.proteinMg)} g`}
                  </p>
                </div>
                {logButton(item, index + 1, option.name, option.missing)}
              </div>
            ))}
          </li>
        );
      })}
      {action.error && (
        <li>
          <ErrorNote message={action.error} />
        </li>
      )}
    </ul>
  );
}

/**
 * On someone's meal plan post (spec 042): keep the plan as your own and start using it, in one
 * tap. Every food is saved as your copy first, because your plan can only hold your own foods.
 * A page has no diary, so it is not offered one.
 */
export function UsePlanFromPost({
  postId,
  title,
  programme = false,
}: {
  postId: string;
  title: string;
  /**
   * Spec 043, slice 5: the post also carries a training plan that may be copied. Following then
   * takes the whole programme: the meal plan followed, the training plan copied into Training, and
   * both paired as the reader's own programme. One button; nothing to pick apart.
   */
  programme?: boolean;
}) {
  const action = useAction();
  const [done, setDone] = useState(false);
  // Foods in the post the reader already has by the same name: they choose theirs or copies.
  const [asking, setAsking] = useState<string[] | null>(null);
  if (actingPageId()) return null;
  if (done)
    return (
      <p role="status" className="mt-3 rounded-lg bg-success-solid/10 px-3 py-2 text-sm text-success">
        You are following this {programme ? 'programme' : 'plan'} now.{' '}
        <Link href="/nutrition" className="font-medium underline">
          See today in Food
        </Link>
        {programme && (
          <>
            {' · '}
            <Link href="/training" className="font-medium underline">
              Its workouts in Training
            </Link>
          </>
        )}
      </p>
    );
  const save = async (policy: 'skip' | 'copy') => {
    // The card may show only the first foods; the plan is saved whole.
    const full = await api.get<FoodPost>(`/posts/${postId}`);
    const saved = await api.post<PostImportResult>(`/posts/${postId}/import`, {
      itemKeys: full.items.map((item) => item.key),
      duplicatePolicy: policy,
      saveAsMeal: false,
      savePlan: true,
      mealName: title,
    });
    if (!saved.mealPlanId) throw new Error('This plan could not be saved.');
    // The conflict check was made before saving; now only follow it.
    await api.put(`${PLANS_KEY}/${saved.mealPlanId}/follow`, { today: mealContextNow().day });
    if (programme && full.training) {
      // The training plan joins Training as the reader's copy (once per post), and the two are
      // paired as their programme, unless a programme of theirs already pairs this meal plan.
      const copied = await api.post<TrainingCopyResult>(`/posts/${postId}/training-copy`, {
        requestId: crypto.randomUUID(),
        ...(copyNeedsPlanChoice(full.training) ? { planName: title } : {}),
      });
      const mine = await api.get<Programme[]>('/programmes');
      if (copied.planId && !mine.some((each) => each.mealPlan?.id === saved.mealPlanId))
        await api.post('/programmes', { name: title, mealPlanId: saved.mealPlanId, trainingPlanId: copied.planId });
      await Promise.all([revalidate('/programmes'), revalidate('/training')]);
    }
    await refreshPlans();
    setAsking(null);
    setDone(true);
  };
  const start = (policy: 'skip' | 'copy') => void action.run(() => save(policy), { revalidate: false });
  const begin = () =>
    void action.run(
      async () => {
        const post = await api.get<FoodPost>(`/posts/${postId}`);
        const rules = post.planRules ? [...post.planRules.plan, ...post.planRules.days.flat()] : [];
        if (!(await okToFollow(title, rules))) return;
        const preview = await api.get<PostImportPreview>(`/posts/${postId}/import`);
        const mine = [...new Set(preview.items.flatMap((item) => (item.duplicateName ? [item.duplicateName] : [])))];
        if (mine.length) setAsking(mine);
        else await save('copy');
      },
      { revalidate: false },
    );
  return (
    <div className="mt-3">
      {asking ? (
        <div className="rounded-xl border border-border p-3">
          <p className="text-sm font-medium">
            You already have {asking.length === 1 ? 'a food' : `${asking.length} foods`} with the same name:
          </p>
          <p className="mt-1 text-sm text-ink-muted">{asking.join(', ')}</p>
          <p className="mt-2 text-xs text-ink-faint">
            Use yours and the plan uses your foods and their numbers, with nothing new in your foods. Or save the post&apos;s foods as new foods, with its numbers.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="btn-primary" disabled={action.pending} onClick={() => start('skip')}>
              Use my foods
            </button>
            <button type="button" className="btn-ghost border border-border" disabled={action.pending} onClick={() => start('copy')}>
              Save the post&apos;s foods
            </button>
            <button type="button" className="btn-ghost" disabled={action.pending} onClick={() => setAsking(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <button type="button" className="btn-primary w-full justify-center" disabled={action.pending} onClick={begin}>
            <CalendarCheck size={16} /> {action.pending ? 'Saving…' : programme ? 'Follow this programme' : 'Follow this plan'}
          </button>
          <p className="mt-1 text-center text-xs text-ink-faint">{programme ? 'Follows its meal plan in Food and copies its training plan to Training, as one programme of yours. Nothing is logged.' : 'Saves the plan to your Food and shows its meals there each day. Nothing is logged.'}</p>
        </>
      )}
      {action.error && <ErrorNote message={action.error} />}
    </div>
  );
}

/**
 * Meal plans (spec 042): named days of meals, each line a recipe or a food with an amount. For
 * a person (`canLog`) a day can be logged into today's diary; a page only keeps and posts them.
 */
export function MealPlans({ canLog }: { canLog: boolean }) {
  const plans = useApi<MealPlan[]>(PLANS_KEY);
  const action = useAction();
  const [editing, setEditing] = useState<MealPlan | 'new' | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [logged, setLogged] = useState<string | null>(null);
  const run = (work: () => Promise<unknown>) =>
    action.run(
      async () => {
        await work();
        await refreshPlans();
      },
      { revalidate: false },
    );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-ink-muted">Days of meals, built from your recipes and foods.</p>
        <button type="button" className="btn-primary shrink-0" onClick={() => setEditing('new')}>
          <Plus size={16} /> New meal plan
        </button>
      </div>
      {action.error && <ErrorNote message={action.error} />}
      {logged && (
        <p role="status" className="rounded-lg bg-success-solid/10 px-3 py-2 text-sm text-success">
          {logged}
        </p>
      )}
      {plans.error ? (
        <ErrorNote message={(plans.error as Error).message} />
      ) : !plans.data ? (
        <Spinner />
      ) : plans.data.length === 0 ? (
        <p className="card p-6 text-sm text-ink-muted">No meal plans yet.</p>
      ) : (
        <ul className="space-y-3">
          {plans.data.map((plan) => (
            <li key={plan.id} className="card p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <button type="button" className="min-w-0 flex-1 text-left" aria-expanded={open === plan.id} onClick={() => setOpen(open === plan.id ? null : plan.id)}>
                  <p className="font-medium">
                    {plan.name}
                    {plan.activeSince && <span className="ml-2 rounded-full bg-accent-solid/15 px-2 py-0.5 text-[11px] font-medium text-accent">Following</span>}
                  </p>
                  <p className="text-xs text-ink-faint">
                    {[
                      allPlanRules(plan).length ? `${allPlanRules(plan).length} ${allPlanRules(plan).length === 1 ? 'rule' : 'rules'}` : '',
                      plan.days.some((day) => day.entries.length)
                        ? `${plan.days.length} ${plan.days.length === 1 ? 'day' : 'days'} of meals, about ${plan.dailyAverage.energyKcal} kcal and ${mgToG(plan.dailyAverage.proteinMg)} g protein a day`
                        : '',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                    {plan.complete ? '' : ' · something in it has no numbers'}
                  </p>
                </button>
                <div className="flex shrink-0 items-center gap-1">
                  {canLog && (
                    <button
                      type="button"
                      className="btn-ghost"
                      disabled={action.pending}
                      onClick={() =>
                        void run(async () => {
                          if (plan.activeSince) await unfollowPlan(plan.id);
                          else await followPlan(plan);
                        })
                      }
                    >
                      {plan.activeSince ? 'Stop following' : 'Follow'}
                    </button>
                  )}
                  {plan.complete && (
                    <Link href={newPostHref({ kind: 'mealPlan', mealPlanId: plan.id })} className="btn-ghost" aria-label={`Post ${plan.name}`}>
                      <Share2 size={16} /> Post
                    </Link>
                  )}
                  <button type="button" className="btn-ghost" aria-label={`Edit ${plan.name}`} onClick={() => setEditing(plan)}>
                    <Pencil size={16} />
                  </button>
                  <button
                    type="button"
                    className="btn-ghost"
                    aria-label={`Delete ${plan.name}`}
                    disabled={action.pending}
                    onClick={() => {
                      if (window.confirm(`Delete ${plan.name}?`)) void run(() => api.delete(`${PLANS_KEY}/${plan.id}`));
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
              {plan.description && <p className="mt-2 whitespace-pre-wrap break-words text-sm text-ink-muted">{plan.description}</p>}
              {plan.rules.length > 0 && (
                <ul className="mt-2 space-y-0.5 text-xs text-ink-muted">
                  {plan.rules.map((rule) => (
                    <li key={rule.id}>• {describePlanRule(rule)}</li>
                  ))}
                </ul>
              )}
              {open === plan.id && (
                <ul className="mt-3 space-y-3 border-t border-border pt-3">
                  {plan.days.map((day) => (
                    <li key={day.id}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold">
                          {day.name}
                          <span className="ml-2 text-xs font-normal text-ink-faint">
                            {day.totals.energyKcal} kcal · P {mgToG(day.totals.proteinMg)} g
                          </span>
                        </p>
                        {canLog && day.entries.length > 0 && (
                          <button
                            type="button"
                            className="btn-ghost"
                            disabled={action.pending || day.entries.some((entry) => entry.missing)}
                            title={day.entries.some((entry) => entry.missing) ? 'Something in this day has no numbers' : undefined}
                            onClick={() =>
                              void run(async () => {
                                setLogged(null);
                                const result = await api.post<{ logged: number }>(`${PLANS_KEY}/${plan.id}/days/${day.id}/log`, { day: mealContextNow().day });
                                setLogged(`Logged ${result.logged} ${result.logged === 1 ? 'food' : 'foods'} from ${day.name} into today.`);
                              })
                            }
                          >
                            Log this day today
                          </button>
                        )}
                      </div>
                      {day.rules?.map((rule) => (
                        <p key={rule.id} className="mt-0.5 text-xs text-ink-muted">
                          • {describePlanRule(rule)}
                        </p>
                      ))}
                      {day.entries.length === 0 ? (
                        <p className="mt-1 text-xs text-ink-faint">{day.rules?.length ? 'No meals planned.' : 'Nothing planned.'}</p>
                      ) : (
                        <ul className="mt-1 space-y-0.5 text-sm">
                          {day.entries.map((entry) => (
                            <li key={entry.id} className="flex flex-wrap justify-between gap-x-3">
                              <span className={entry.missing ? 'text-danger' : undefined}>
                                <span className="text-ink-faint">{planSlotsLabel(planLineSlots(entry))} · </span>
                                {entry.name}
                                {entry.amount ? ` · ${entry.amount} ${entry.unit ?? ''}` : ''}
                                {entry.missing ? ' (no numbers)' : ''}
                              </span>
                              <span className="shrink-0 text-ink-muted">{entry.totals.energyKcal} kcal</span>
                              {entry.options?.map((option, index) => (
                                <span key={index} className="basis-full pl-4 text-ink-muted">
                                  <span className="font-semibold text-accent">or</span> {option.name}
                                  {option.amount ? ` · ${option.amount} ${option.unit ?? ''}` : ''} · {option.totals.energyKcal} kcal
                                </span>
                              ))}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing !== null && <MealPlanEditor plan={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

interface Line {
  key: string;
  /** Every meal it may be eaten at; at least one. */
  slots: MealSlot[];
  kind: 'recipe' | 'food';
  savedMealId: string;
  food?: FoodWithUsage;
  amount: string;
  /** Spec 043: other things that may be eaten instead. */
  options: OptionDraft[];
}
interface OptionDraft {
  key: string;
  kind: 'recipe' | 'food';
  savedMealId: string;
  food?: FoodWithUsage;
  amount: string;
}
/** An option or a line, as a save sends it: a recipe, or a food with its amount. */
const choiceInput = (choice: { kind: 'recipe' | 'food'; savedMealId: string; food?: FoodWithUsage; amount: string }) =>
  choice.kind === 'recipe' ? { savedMealId: choice.savedMealId || undefined } : { foodId: choice.food?.id, amount: choice.amount ? Number(choice.amount) : undefined };
interface DayDraft {
  key: string;
  id?: string;
  name: string;
  lines: Line[];
  /** Spec 043: rules for this day only. */
  rules: RuleDraft[];
}
let seq = 0;
const key = () => `k${seq++}`;

/** An amount in a food's own unit, beside an option (spec 043). */
function AmountInput({ value, food, onChange }: { value: string; food?: FoodWithUsage; onChange: (amount: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <Input
        inputMode="numeric"
        aria-label={`Amount${food ? ` of ${food.name}` : ''}`}
        className="w-24 shrink-0"
        placeholder={food?.unit ?? 'g'}
        value={value}
        onChange={(event) => onChange(event.target.value.replace(/\D/g, ''))}
      />
      <span className="text-xs text-ink-faint">{food?.unit ?? 'g'}</span>
    </div>
  );
}

export function MealPlanEditor({ plan, onClose, onSaved }: { plan?: MealPlan; onClose: () => void; /** Told about the saved plan, e.g. to pair it in a programme. */ onSaved?: (plan: MealPlan) => void }) {
  const foods = useApi<FoodWithUsage[]>('/nutrition/foods');
  const recipes = useApi<SavedMeal[]>('/nutrition/meals');
  const action = useAction();
  const live = useMemo(() => (foods.data ?? []).filter((food) => !food.archived), [foods.data]);
  // A recipe can go in a plan only when it has foods with numbers.
  const usable = useMemo(() => (recipes.data ?? []).filter((meal) => meal.loggable), [recipes.data]);
  const [name, setName] = useState(plan?.name ?? '');
  const [description, setDescription] = useState(plan?.description ?? '');
  const [days, setDays] = useState<DayDraft[] | null>(null);
  // Spec 043: rules for every day.
  const [rules, setRules] = useState<RuleDraft[]>(() => (plan?.rules ?? []).map(ruleDraft));
  const ready = !!foods.data && !!recipes.data;
  // Built once the foods are here, so each stored line finds its food.
  const current: DayDraft[] =
    days ??
    (plan
      ? plan.days.map((day) => ({
          key: key(),
          id: day.id,
          name: day.name,
          rules: (day.rules ?? []).map(ruleDraft),
          lines: day.entries.map((entry) => ({
            key: key(),
            slots: planLineSlots(entry),
            kind: entry.savedMealId ? ('recipe' as const) : ('food' as const),
            savedMealId: entry.savedMealId ?? '',
            food: entry.foodId ? live.find((food) => food.id === entry.foodId) : undefined,
            amount: entry.amount ? String(entry.amount) : '',
            options: (entry.options ?? []).map((option) => ({
              key: key(),
              kind: option.savedMealId ? ('recipe' as const) : ('food' as const),
              savedMealId: option.savedMealId ?? '',
              food: option.foodId ? live.find((food) => food.id === option.foodId) : undefined,
              amount: option.amount ? String(option.amount) : '',
            })),
          })),
        }))
      : [{ key: key(), name: 'Day 1', lines: [], rules: [] }]);
  const change = (next: DayDraft[]) => setDays(next);
  const setDay = (dayKey: string, patch: Partial<DayDraft>) => change(current.map((day) => (day.key === dayKey ? { ...day, ...patch } : day)));
  const setLine = (dayKey: string, lineKey: string, patch: Partial<Line>) =>
    change(current.map((day) => (day.key === dayKey ? { ...day, lines: day.lines.map((line) => (line.key === lineKey ? { ...line, ...patch } : line)) } : day)));

  // A plan of rules alone keeps no empty days.
  const keptDays = rules.length && current.every((day) => !day.lines.length && !day.rules.length) ? [] : current;
  const input: MealPlanInput = {
    name,
    description,
    rules: rules.map(toRuleInput),
    days: keptDays.map((day) => ({
      ...(day.id ? { id: day.id } : {}),
      name: day.name,
      ...(day.rules.length ? { rules: day.rules.map(toRuleInput) } : {}),
      entries: day.lines.map((line) =>
        ({
          ...lineSlotsInput(line.slots),
          ...choiceInput(line),
          ...(line.options.length ? { options: line.options.map(choiceInput) } : {}),
        }),
      ),
    })),
  };
  const problem = mealPlanProblem(input);
  const save = () =>
    action
      .run(
        async () => {
          const saved = await (plan ? api.put<MealPlan>(`${PLANS_KEY}/${plan.id}`, input) : api.post<MealPlan>(PLANS_KEY, input));
          await revalidate(PLANS_KEY);
          onSaved?.(saved);
        },
        { revalidate: false },
      )
      .then((ok) => ok && onClose());

  return (
    <Modal open onClose={onClose} title={plan ? 'Edit meal plan' : 'New meal plan'} wide>
      {!ready ? (
        <Spinner />
      ) : (
        <div className="space-y-4">
          <Field label="Name">
            <Input value={name} maxLength={MEAL_PLAN_LIMITS.name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label="What it is for" hint="Optional.">
            <Textarea rows={2} maxLength={MEAL_PLAN_LIMITS.description} value={description} onChange={(event) => setDescription(event.target.value)} />
          </Field>
          <section className="space-y-2 rounded-xl border border-border p-3">
            <div>
              <p className="text-sm font-semibold">Rules</p>
              <p className="text-xs text-ink-muted">Numbers to aim for, every day: calories and macros for the day or a meal. A plan can be only rules.</p>
            </div>
            <PlanRulesEditor rules={rules} onChange={setRules} max={PLAN_RULE_LIMITS.perPlan} />
          </section>
          <p className="pt-1 text-sm font-semibold">Days of meals {rules.length ? <span className="font-normal text-ink-faint">(optional)</span> : null}</p>
          {current.map((day) => (
            <section key={day.key} className="space-y-2 rounded-xl border border-border p-3">
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Field label="Day">
                    <Input value={day.name} maxLength={MEAL_PLAN_LIMITS.dayName} placeholder="Training day" onChange={(event) => setDay(day.key, { name: event.target.value })} />
                  </Field>
                </div>
                <button type="button" className="btn-ghost" aria-label={`Remove ${day.name || 'this day'}`} disabled={current.length === 1} onClick={() => change(current.filter((item) => item.key !== day.key))}>
                  <Trash2 size={16} />
                </button>
              </div>
              <ul className="space-y-2">
                {day.lines.map((line) => (
                  <li key={line.key} className="space-y-2 rounded-lg border border-border/70 p-2">
                    {/* What is eaten takes the whole row: squeezed beside the other controls, the
                        food picker has no room for its search box or its list. */}
                    {line.kind === 'recipe' ? (
                      <Select aria-label="Recipe" value={line.savedMealId} onChange={(event) => setLine(day.key, line.key, { savedMealId: event.target.value })}>
                        <option value="">Choose a recipe…</option>
                        {usable.map((meal) => (
                          <option key={meal.id} value={meal.id}>
                            {meal.name} · {meal.totals.energyKcal} kcal
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <FoodCombobox foods={live} selected={line.food} onSelect={(food) => setLine(day.key, line.key, { food, amount: line.amount || String(food.servingSize) })} />
                    )}
                    {line.kind === 'food' && line.options.length > 0 && (
                      <AmountInput value={line.amount} food={line.food} onChange={(amount) => setLine(day.key, line.key, { amount })} />
                    )}
                    {/* Spec 043: "or" options. Eating any one of them meets the line. */}
                    {line.options.map((option) => {
                      const setOption = (patch: Partial<OptionDraft>) => setLine(day.key, line.key, { options: line.options.map((each) => (each.key === option.key ? { ...each, ...patch } : each)) });
                      return (
                        <div key={option.key} className="space-y-1.5 border-l-2 border-accent-solid/40 pl-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold uppercase tracking-wide text-accent">or</span>
                            <button type="button" className="btn-ghost shrink-0" aria-label="Remove this option" onClick={() => setLine(day.key, line.key, { options: line.options.filter((each) => each.key !== option.key) })}>
                              <Trash2 size={14} />
                            </button>
                          </div>
                          {option.kind === 'recipe' ? (
                            <Select aria-label="Recipe" value={option.savedMealId} onChange={(event) => setOption({ savedMealId: event.target.value })}>
                              <option value="">Choose a recipe…</option>
                              {usable.map((meal) => (
                                <option key={meal.id} value={meal.id}>
                                  {meal.name} · {meal.totals.energyKcal} kcal
                                </option>
                              ))}
                            </Select>
                          ) : (
                            <>
                              <FoodCombobox foods={live} selected={option.food} onSelect={(food) => setOption({ food, amount: option.amount || String(food.servingSize) })} />
                              <AmountInput value={option.amount} food={option.food} onChange={(amount) => setOption({ amount })} />
                            </>
                          )}
                        </div>
                      );
                    })}
                    {line.options.length < MEAL_PLAN_OPTIONS_MAX && (
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          className="rounded-full border border-border px-2.5 py-1 text-xs text-ink-muted hover:text-ink"
                          disabled={!live.length}
                          onClick={() => setLine(day.key, line.key, { options: [...line.options, { key: key(), kind: 'food', savedMealId: '', amount: '' }] })}
                        >
                          + Or a food
                        </button>
                        {usable.length > 0 && (
                          <button
                            type="button"
                            className="rounded-full border border-border px-2.5 py-1 text-xs text-ink-muted hover:text-ink"
                            onClick={() => setLine(day.key, line.key, { options: [...line.options, { key: key(), kind: 'recipe', savedMealId: '', amount: '' }] })}
                          >
                            + Or a recipe
                          </button>
                        )}
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      {/* One meal, or several: "lunch or dinner", or all four for any time. */}
                      <div className="flex min-w-0 flex-1 flex-wrap gap-1" role="group" aria-label="Eaten at">
                        {PLAN_ANY_TIME.map((slot) => {
                          const on = line.slots.includes(slot);
                          return (
                            <button
                              key={slot}
                              type="button"
                              aria-pressed={on}
                              className={`rounded-full border px-2.5 py-1 text-xs font-medium ${on ? 'border-transparent bg-accent-solid text-on-accent' : 'border-border text-ink-muted'}`}
                              onClick={() => {
                                const next = on ? line.slots.filter((each) => each !== slot) : [...line.slots, slot];
                                if (next.length) setLine(day.key, line.key, { slots: PLAN_ANY_TIME.filter((each) => next.includes(each)) });
                              }}
                            >
                              {slotLabel(slot)}
                            </button>
                          );
                        })}
                      </div>
                      {line.kind === 'food' && line.options.length === 0 && (
                        <Input
                          inputMode="numeric"
                          aria-label={`Amount${line.food ? ` of ${line.food.name}` : ''}`}
                          className="w-24 shrink-0"
                          placeholder={line.food?.unit ?? 'g'}
                          value={line.amount}
                          onChange={(event) => setLine(day.key, line.key, { amount: event.target.value.replace(/\D/g, '') })}
                        />
                      )}
                      <button type="button" className="btn-ghost shrink-0" aria-label="Remove this line" onClick={() => setDay(day.key, { lines: day.lines.filter((item) => item.key !== line.key) })}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              {/* Rules that only this day has, e.g. more carbs on a training day. */}
              {(day.rules.length > 0 || current.length > 1) && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-ink-muted">Rules for this day only</p>
                  <PlanRulesEditor rules={day.rules} onChange={(next) => setDay(day.key, { rules: next })} max={PLAN_RULE_LIMITS.perDay} presets={false} />
                </div>
              )}
              {day.lines.length < MEAL_PLAN_LIMITS.entriesPerDay && (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={!usable.length}
                    title={usable.length ? undefined : 'You have no recipes with foods yet'}
                    onClick={() => setDay(day.key, { lines: [...day.lines, { key: key(), slots: ['breakfast'], kind: 'recipe', savedMealId: '', amount: '', options: [] }] })}
                  >
                    <Plus size={16} /> Recipe
                  </button>
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={!live.length}
                    title={live.length ? undefined : 'You have no foods yet'}
                    onClick={() => setDay(day.key, { lines: [...day.lines, { key: key(), slots: ['breakfast'], kind: 'food', savedMealId: '', amount: '', options: [] }] })}
                  >
                    <Plus size={16} /> Food
                  </button>
                </div>
              )}
            </section>
          ))}
          {current.length < MEAL_PLAN_LIMITS.days && (
            <button type="button" className="btn-ghost" onClick={() => change([...current, { key: key(), name: `Day ${current.length + 1}`, lines: [], rules: [] }])}>
              <Plus size={16} /> Add a day
            </button>
          )}
          {!live.length && !usable.length && !rules.length && <p className="text-xs text-ink-muted">Days of meals are built from your foods and recipes, and you have none yet. Rules need none.</p>}
          {problem && (name || rules.length || current.some((day) => day.lines.length)) && <p className="text-xs text-ink-muted">{problem}</p>}
          {action.error && <ErrorNote message={action.error} />}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn-primary" disabled={!!problem || action.pending} onClick={() => void save()}>
              Save
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** Every followed rule on each food, with its plan. */
export const eachFoodRules = (plans: readonly ActiveMealPlan[]) =>
  plans.flatMap((plan) => plan.rules.filter((rule) => rule.each).map((rule) => ({ rule, planId: plan.planId, planName: plan.name })));

/**
 * Followed rules on each food, against one food (spec 043, slice 4): shown while choosing a food
 * and under a logged meal that breaks one. Advice only: nothing is refused. `onlyBroken` hides the
 * rules the food meets.
 */
export function FoodRuleNotes({ checks, onlyBroken = false }: { checks: readonly FoodRuleCheck[]; onlyBroken?: boolean }) {
  const shown = onlyBroken ? checks.filter((check) => check.status === 'over' || check.status === 'under') : checks;
  if (!shown.length) return null;
  const valueText = (check: FoodRuleCheck) =>
    check.value === undefined
      ? ''
      : check.basis === 'share'
        ? `${check.value}%`
        : check.metric === 'energy'
          ? `${check.value} kcal`
          : `${mgToG(check.value, 1)} g`;
  return (
    <ul className="space-y-0.5 text-[12px] leading-snug" aria-label="Your plan on this food">
      {shown.map((check, index) => (
        <li key={index} className={check.status === 'met' ? 'text-success' : check.status === 'unknown' ? 'text-ink-faint' : 'text-warning'} title={check.planName}>
          {check.status === 'met' ? '✓ ' : check.status === 'unknown' ? '? ' : '! '}
          {check.text}
          {check.status === 'unknown' ? ' (this food does not say)' : ` · this has ${valueText(check)}`}
        </li>
      ))}
    </ul>
  );
}
