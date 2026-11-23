'use client';

import Link from 'next/link';
import { CalendarCheck, Pencil, Plus, Share2, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  MEAL_PLAN_LIMITS,
  MEAL_SLOTS,
  type ActiveMealPlan,
  type ActivePlanLine,
  type FoodPost,
  type FoodWithUsage,
  type MealPlan,
  type MealEntry,
  type MealPlanInput,
  type MealSlot,
  type PostImportPreview,
  type PostImportResult,
  type SavedMeal,
} from '@life-portal/shared-types';
import { PLAN_ANY_TIME, matchPlanDay, mealPlanProblem, mgToG, planLineSlots, planSlotsLabel } from '@life-portal/shared-domain';
import { api } from '../lib/api';
import { revalidate, useAction, useApi } from '../lib/hooks';
import { actingPageId } from '../lib/identity';
import { mealContextNow } from '../lib/local-day';
import { newPostHref } from '../lib/new-post';
import { FoodCombobox } from './food-combobox';
import { ErrorNote, Field, Input, Modal, Select, Spinner, Textarea } from './ui';

const PLANS_KEY = '/nutrition/meal-plans';
const ACTIVE_KEY = `${PLANS_KEY}/active`;
const slotLabel = (slot: MealSlot) => slot.charAt(0).toUpperCase() + slot.slice(1);
/** A line's meals as a save sends them: the first as `slot`, all of them only when there is a choice. */
const lineSlotsInput = (slots: MealSlot[]) => ({ slot: slots[0] ?? 'breakfast', ...(slots.length > 1 ? { slots } : {}) });
/** Everything a change to plans or to what is logged from one can alter. */
const refreshPlans = () => Promise.all([revalidate(PLANS_KEY), revalidate('/nutrition?'), revalidate('/dashboard')]);

/** The plan in use as it applies to the calendar day on screen. A page has no diary, so none. */
export function useActivePlan(today: string | null, day: string | null): ActiveMealPlan | null {
  const key = today && day && !actingPageId() ? `${ACTIVE_KEY}?today=${today}&day=${day}` : null;
  return useApi<{ active: ActiveMealPlan | null }>(key).data?.active ?? null;
}

/** What the diary on screen says about the plan day: which meals stand for which lines. */
export function planOnDay(plan: ActiveMealPlan | null, entries: readonly MealEntry[]) {
  const match = plan ? matchPlanDay(plan.day.lines, entries.map((entry) => ({ ...entry, name: entry.facts.name }))) : new Map<string, string[]>();
  const marks = new Set([...match.values()].flat());
  const counted = plan ? plan.day.lines.filter((line) => !line.missing) : [];
  return {
    match,
    marks,
    /** Lines not eaten yet, each listed at every meal it may be eaten at. */
    openAt: (slot: MealSlot) => (plan ? plan.day.lines.filter((line) => !match.has(line.id) && !line.missing && planLineSlots(line).includes(slot)) : []),
    followed: counted.filter((line) => match.has(line.id)).length,
    planned: counted.length,
    eatenKcal: entries.filter((entry) => marks.has(entry.id)).reduce((sum, entry) => sum + entry.totals.energyKcal, 0),
  };
}

const logPlanned = (plan: ActiveMealPlan, day: string, lines: ActivePlanLine[], slot?: MealSlot) =>
  api.post(`${PLANS_KEY}/${plan.planId}/days/${plan.day.id}/log`, { day, entryIds: lines.map((line) => line.id), ...(slot ? { slot } : {}) });

/**
 * The plan in use, above the day's meals (spec 042): which plan day this is (and a picker), how
 * much of it is eaten, and the last seven days. The planned lines themselves sit inside each
 * meal, beside what was eaten (`PlannedLines`).
 */
export function PlanStrip({ plan, entries, day, onChanged }: { plan: ActiveMealPlan; entries: readonly MealEntry[]; day: string; onChanged: () => void }) {
  const action = useAction();
  const state = planOnDay(plan, entries);
  const left = plan.day.lines.filter((line) => !line.missing && !state.match.has(line.id));
  const run = (work: () => Promise<unknown>) =>
    action.run(
      async () => {
        await work();
        await refreshPlans();
        onChanged();
      },
      { revalidate: false },
    );
  return (
    <section className="card p-3" aria-label="Meal plan">
      <div className="flex items-center gap-2">
        <CalendarCheck size={18} className="shrink-0 text-accent" aria-hidden />
        <p className="min-w-0 flex-1 truncate text-sm font-semibold">{plan.name}</p>
        {left.length > 0 && (
          <button type="button" className="shrink-0 text-xs font-medium text-accent" disabled={action.pending} onClick={() => void run(() => logPlanned(plan, day, left))}>
            Log the rest
          </button>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        {plan.days.length > 1 ? (
          <Select
            aria-label="Which day of the plan this is"
            className="w-auto max-w-[12rem]"
            value={plan.day.id}
            disabled={action.pending}
            onChange={(event) => void run(() => api.put(`${ACTIVE_KEY}/day`, { day, dayId: event.target.value }))}
          >
            {plan.days.map((each) => (
              <option key={each.id} value={each.id}>
                {each.name}
              </option>
            ))}
          </Select>
        ) : (
          <span className="text-sm text-ink-muted">{plan.day.name}</span>
        )}
        <span className="text-xs text-ink-muted">
          {state.followed} of {state.planned} eaten · {state.eatenKcal.toLocaleString()} of {plan.day.totals.energyKcal.toLocaleString()} kcal
        </span>
      </div>
      {/* The last seven days, each as how much of its plan day was eaten. */}
      <ol className="mt-3 flex items-end gap-1.5" aria-label="The last seven days">
        {plan.recent.map((each) => {
          const share = each.planned ? each.followed / each.planned : 0;
          return (
            <li key={each.day} className="flex flex-1 flex-col items-center gap-1" title={`${each.day} · ${each.dayName}: ${each.followed} of ${each.planned} eaten`}>
              <span className="flex h-7 w-full items-end overflow-hidden rounded bg-border/60">
                <span className={`w-full rounded ${share >= 0.8 ? 'bg-success-solid' : share > 0 ? 'bg-accent-solid' : ''}`} style={{ height: `${Math.round(share * 100)}%` }} />
              </span>
              <span className={`text-[10px] ${each.day === day ? 'font-bold text-ink' : 'text-ink-faint'}`}>
                {new Date(`${each.day}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'narrow' })}
              </span>
            </li>
          );
        })}
      </ol>
      {action.error && <ErrorNote message={action.error} />}
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          className="text-[11px] text-ink-faint underline"
          disabled={action.pending}
          onClick={() => {
            if (window.confirm(`Stop using ${plan.name}? The plan stays in your meal plans.`)) void run(() => api.put(ACTIVE_KEY, { planId: null, today: mealContextNow().day }));
          }}
        >
          Stop using this plan
        </button>
      </div>
    </section>
  );
}

/**
 * A meal's planned lines that are not eaten yet, under what was eaten (spec 042). Log puts the
 * line into this meal of the day on screen, frozen at today's numbers like any meal.
 */
export function PlannedLines({ plan, lines, slot, day, onChanged }: { plan: ActiveMealPlan; lines: ActivePlanLine[]; slot: MealSlot; day: string; onChanged: () => void }) {
  const action = useAction();
  const [busy, setBusy] = useState<string | null>(null);
  if (!lines.length) return null;
  const log = (line: ActivePlanLine) => {
    setBusy(line.id);
    void action
      .run(
        async () => {
          await logPlanned(plan, day, [line], slot);
          await refreshPlans();
          onChanged();
        },
        { revalidate: false },
      )
      .finally(() => setBusy(null));
  };
  return (
    <ul className="space-y-1 px-1.5 pb-1.5 sm:px-4 sm:pb-3" aria-label="Planned">
      {lines.map((line) => {
        const slots = planLineSlots(line);
        return (
          <li key={line.id} className="flex items-center gap-2 rounded-xl border border-dashed border-border px-2.5 py-2 text-[15px] leading-snug">
            <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-lg text-ink-faint">
              <CalendarCheck size={18} aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-ink-muted">{line.name}</p>
              <p className="truncate text-[13px] text-ink-faint">
                Planned{slots.length > 1 ? ` · ${planSlotsLabel(slots).toLowerCase()}` : ''} · {line.amount ? `${line.amount} ${line.unit ?? ''} · ` : ''}
                {line.totals.energyKcal} kcal · P {mgToG(line.totals.proteinMg)} g
              </p>
            </div>
            <button type="button" className="btn-ghost shrink-0 border border-border px-3" disabled={action.pending} aria-label={`Log ${line.name}`} onClick={() => log(line)}>
              {busy === line.id ? '…' : 'Log'}
            </button>
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
export function UsePlanFromPost({ postId, title }: { postId: string; title: string }) {
  const action = useAction();
  const [done, setDone] = useState(false);
  // Foods in the post the reader already has by the same name: they choose theirs or copies.
  const [asking, setAsking] = useState<string[] | null>(null);
  if (actingPageId()) return null;
  if (done)
    return (
      <p role="status" className="mt-3 rounded-lg bg-success-solid/10 px-3 py-2 text-sm text-success">
        You are using this plan now.{' '}
        <Link href="/nutrition" className="font-medium underline">
          See today in Food
        </Link>
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
    await api.put(ACTIVE_KEY, { planId: saved.mealPlanId, today: mealContextNow().day });
    await refreshPlans();
    setAsking(null);
    setDone(true);
  };
  const start = (policy: 'skip' | 'copy') => void action.run(() => save(policy), { revalidate: false });
  const begin = () =>
    void action.run(
      async () => {
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
            <CalendarCheck size={16} /> {action.pending ? 'Saving the plan…' : 'Use this plan'}
          </button>
          <p className="mt-1 text-center text-xs text-ink-faint">Saves the plan to your Food and shows its meals there each day. Nothing is logged.</p>
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
                    {plan.activeSince && <span className="ml-2 rounded-full bg-accent-solid/15 px-2 py-0.5 text-[11px] font-medium text-accent">In use</span>}
                  </p>
                  <p className="text-xs text-ink-faint">
                    {plan.days.length} {plan.days.length === 1 ? 'day' : 'days'} · about {plan.dailyAverage.energyKcal} kcal and {mgToG(plan.dailyAverage.proteinMg)} g protein a day
                    {plan.complete ? '' : ' · something in it has no numbers'}
                  </p>
                </button>
                <div className="flex shrink-0 items-center gap-1">
                  {canLog && (
                    <button
                      type="button"
                      className="btn-ghost"
                      disabled={action.pending}
                      onClick={() => void run(() => api.put(ACTIVE_KEY, { planId: plan.activeSince ? null : plan.id, today: mealContextNow().day }))}
                    >
                      {plan.activeSince ? 'Stop using' : 'Use'}
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
                      {day.entries.length === 0 ? (
                        <p className="mt-1 text-xs text-ink-faint">Nothing planned.</p>
                      ) : (
                        <ul className="mt-1 space-y-0.5 text-sm">
                          {day.entries.map((entry) => (
                            <li key={entry.id} className="flex justify-between gap-3">
                              <span className={entry.missing ? 'text-danger' : undefined}>
                                <span className="text-ink-faint">{planSlotsLabel(planLineSlots(entry))} · </span>
                                {entry.name}
                                {entry.amount ? ` · ${entry.amount} ${entry.unit ?? ''}` : ''}
                                {entry.missing ? ' (no numbers)' : ''}
                              </span>
                              <span className="shrink-0 text-ink-muted">{entry.totals.energyKcal} kcal</span>
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
}
interface DayDraft {
  key: string;
  id?: string;
  name: string;
  lines: Line[];
}
let seq = 0;
const key = () => `k${seq++}`;

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
  const ready = !!foods.data && !!recipes.data;
  // Built once the foods are here, so each stored line finds its food.
  const current: DayDraft[] =
    days ??
    (plan
      ? plan.days.map((day) => ({
          key: key(),
          id: day.id,
          name: day.name,
          lines: day.entries.map((entry) => ({
            key: key(),
            slots: planLineSlots(entry),
            kind: entry.savedMealId ? ('recipe' as const) : ('food' as const),
            savedMealId: entry.savedMealId ?? '',
            food: entry.foodId ? live.find((food) => food.id === entry.foodId) : undefined,
            amount: entry.amount ? String(entry.amount) : '',
          })),
        }))
      : [{ key: key(), name: 'Day 1', lines: [] }]);
  const change = (next: DayDraft[]) => setDays(next);
  const setDay = (dayKey: string, patch: Partial<DayDraft>) => change(current.map((day) => (day.key === dayKey ? { ...day, ...patch } : day)));
  const setLine = (dayKey: string, lineKey: string, patch: Partial<Line>) =>
    change(current.map((day) => (day.key === dayKey ? { ...day, lines: day.lines.map((line) => (line.key === lineKey ? { ...line, ...patch } : line)) } : day)));

  const input: MealPlanInput = {
    name,
    description,
    days: current.map((day) => ({
      ...(day.id ? { id: day.id } : {}),
      name: day.name,
      entries: day.lines.map((line) =>
        ({
          ...lineSlotsInput(line.slots),
          ...(line.kind === 'recipe' ? { savedMealId: line.savedMealId || undefined } : { foodId: line.food?.id, amount: line.amount ? Number(line.amount) : undefined }),
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
                      {line.kind === 'food' && (
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
              {day.lines.length < MEAL_PLAN_LIMITS.entriesPerDay && (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={!usable.length}
                    title={usable.length ? undefined : 'You have no recipes with foods yet'}
                    onClick={() => setDay(day.key, { lines: [...day.lines, { key: key(), slots: ['breakfast'], kind: 'recipe', savedMealId: '', amount: '' }] })}
                  >
                    <Plus size={16} /> Recipe
                  </button>
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={!live.length}
                    title={live.length ? undefined : 'You have no foods yet'}
                    onClick={() => setDay(day.key, { lines: [...day.lines, { key: key(), slots: ['breakfast'], kind: 'food', savedMealId: '', amount: '' }] })}
                  >
                    <Plus size={16} /> Food
                  </button>
                </div>
              )}
            </section>
          ))}
          {current.length < MEAL_PLAN_LIMITS.days && (
            <button type="button" className="btn-ghost" onClick={() => change([...current, { key: key(), name: `Day ${current.length + 1}`, lines: [] }])}>
              <Plus size={16} /> Add a day
            </button>
          )}
          {!live.length && !usable.length && <p className="text-xs text-warning">A plan is built from your foods and recipes, and you have none yet. Add a food first.</p>}
          {problem && (name || current.some((day) => day.lines.length)) && <p className="text-xs text-ink-muted">{problem}</p>}
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
