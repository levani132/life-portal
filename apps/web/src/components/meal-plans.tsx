'use client';

import Link from 'next/link';
import { CalendarCheck, Check, Pencil, Plus, Share2, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  MEAL_PLAN_LIMITS,
  MEAL_SLOTS,
  type ActiveMealPlan,
  type ActivePlanLine,
  type FoodPost,
  type FoodWithUsage,
  type MealPlan,
  type MealPlanInput,
  type MealSlot,
  type PostImportResult,
  type SavedMeal,
} from '@life-portal/shared-types';
import { mealPlanProblem, mgToG } from '@life-portal/shared-domain';
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
/** Everything a change to plans or to what is logged from one can alter. */
const refreshPlans = () => Promise.all([revalidate(PLANS_KEY), revalidate('/nutrition?'), revalidate('/dashboard')]);

/**
 * The plan in use, as today's list of what to eat (spec 042). Each line has its own Log button;
 * a meal can be logged whole. What is done comes from today's diary, so deleting a meal below
 * makes its line loggable again. Shown on today only: a plan's day is today's question.
 */
export function ActivePlanCard({ today, onChanged }: { today: string; onChanged: () => void }) {
  const active = useApi<{ active: ActiveMealPlan | null }>(`${ACTIVE_KEY}?today=${today}`);
  const action = useAction();
  const [busy, setBusy] = useState<string | null>(null);
  const plan = active.data?.active;
  if (!plan) return null;
  const run = (what: string, work: () => Promise<unknown>) => {
    setBusy(what);
    return action
      .run(
        async () => {
          await work();
          await refreshPlans();
          onChanged();
        },
        { revalidate: false },
      )
      .finally(() => setBusy(null));
  };
  const log = (what: string, lines: ActivePlanLine[]) =>
    run(what, () => api.post(`${PLANS_KEY}/${plan.planId}/days/${plan.day.id}/log`, { day: today, entryIds: lines.map((line) => line.id) }));
  const slots = MEAL_SLOTS.map((slot) => ({ slot, lines: plan.day.lines.filter((line) => line.slot === slot) })).filter((group) => group.lines.length);
  const left = plan.day.lines.filter((line) => !line.logged && !line.missing);
  const share = plan.day.totals.energyKcal > 0 ? Math.min(100, Math.round((plan.day.loggedTotals.energyKcal / plan.day.totals.energyKcal) * 100)) : 0;

  return (
    <section className="card p-4" aria-label="Planned today">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-ink-faint">
            <CalendarCheck size={12} aria-hidden /> Planned today
          </p>
          <p className="truncate font-semibold">{plan.name}</p>
        </div>
        {plan.days.length > 1 && (
          <Select
            aria-label="Which day of the plan is today"
            className="w-auto max-w-[11rem] shrink-0"
            value={plan.day.id}
            disabled={action.pending}
            onChange={(event) => void run('day', () => api.put(`${ACTIVE_KEY}/day`, { today, dayId: event.target.value }))}
          >
            {plan.days.map((day) => (
              <option key={day.id} value={day.id}>
                {day.name}
              </option>
            ))}
          </Select>
        )}
      </div>
      <div className="mt-3">
        <div className="h-1.5 overflow-hidden rounded-full bg-border">
          <div className="h-full rounded-full bg-accent-solid transition-[width]" style={{ width: `${share}%` }} />
        </div>
        <p className="mt-1 text-xs text-ink-muted">
          {plan.day.loggedTotals.energyKcal} of {plan.day.totals.energyKcal} kcal logged · P {mgToG(plan.day.loggedTotals.proteinMg)} of {mgToG(plan.day.totals.proteinMg)} g
        </p>
      </div>
      {action.error && <ErrorNote message={action.error} />}
      {slots.length === 0 ? (
        <p className="mt-3 text-sm text-ink-muted">Nothing is planned for {plan.day.name}.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {slots.map((group) => {
            const open = group.lines.filter((line) => !line.logged && !line.missing);
            return (
              <li key={group.slot}>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{slotLabel(group.slot)}</p>
                  {open.length > 1 && (
                    <button type="button" className="text-xs font-medium text-accent" disabled={action.pending} onClick={() => void log(group.slot, open)}>
                      {busy === group.slot ? 'Logging…' : `Log all ${open.length}`}
                    </button>
                  )}
                </div>
                <ul className="mt-1 divide-y divide-border/60">
                  {group.lines.map((line) => (
                    <li key={line.id} className="flex items-center gap-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p className={`truncate text-sm ${line.logged ? 'text-ink-muted line-through' : line.missing ? 'text-danger' : ''}`}>{line.name}</p>
                        <p className="text-xs text-ink-faint">
                          {line.missing ? 'No numbers: edit the plan' : `${line.amount ? `${line.amount} ${line.unit ?? ''} · ` : ''}${line.totals.energyKcal} kcal · P ${mgToG(line.totals.proteinMg)} g`}
                        </p>
                      </div>
                      {line.logged ? (
                        <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-success">
                          <Check size={14} aria-hidden /> Logged
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="btn-ghost shrink-0 border border-border"
                          disabled={action.pending || line.missing}
                          aria-label={`Log ${line.name}`}
                          onClick={() => void log(line.id, [line])}
                        >
                          {busy === line.id ? 'Logging…' : 'Log'}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        {left.length > 1 ? (
          <button type="button" className="btn-ghost" disabled={action.pending} onClick={() => void log('all', left)}>
            {busy === 'all' ? 'Logging…' : 'Log everything left'}
          </button>
        ) : (
          <span className="text-xs text-ink-faint">{left.length === 0 && slots.length > 0 ? 'Everything planned is logged.' : ''}</span>
        )}
        <button
          type="button"
          className="text-xs text-ink-muted underline"
          disabled={action.pending}
          onClick={() => {
            if (window.confirm(`Stop using ${plan.name}? The plan stays in your meal plans.`)) void run('stop', () => api.put(ACTIVE_KEY, { planId: null, today }));
          }}
        >
          Stop using this plan
        </button>
      </div>
    </section>
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
  return (
    <div className="mt-3">
      <button
        type="button"
        className="btn-primary w-full justify-center"
        disabled={action.pending}
        onClick={() =>
          void action.run(
            async () => {
              // The card may show only the first foods; the plan is copied whole.
              const full = await api.get<FoodPost>(`/posts/${postId}`);
              const saved = await api.post<PostImportResult>(`/posts/${postId}/import`, {
                itemKeys: full.items.map((item) => item.key),
                duplicatePolicy: 'copy',
                saveAsMeal: false,
                savePlan: true,
                mealName: title,
              });
              if (!saved.mealPlanId) throw new Error('This plan could not be saved.');
              await api.put(ACTIVE_KEY, { planId: saved.mealPlanId, today: mealContextNow().day });
              await refreshPlans();
              setDone(true);
            },
            { revalidate: false },
          )
        }
      >
        <CalendarCheck size={16} /> {action.pending ? 'Saving the plan…' : 'Use this plan'}
      </button>
      <p className="mt-1 text-center text-xs text-ink-faint">Saves its foods and the plan to your Food, and shows its meals there each day. Nothing is logged.</p>
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
                                <span className="text-ink-faint">{slotLabel(entry.slot)} · </span>
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
  slot: MealSlot;
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
            slot: entry.slot,
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
        line.kind === 'recipe' ? { slot: line.slot, savedMealId: line.savedMealId || undefined } : { slot: line.slot, foodId: line.food?.id, amount: line.amount ? Number(line.amount) : undefined },
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
                      <Select aria-label="Meal" className="min-w-[7rem] flex-1" value={line.slot} onChange={(event) => setLine(day.key, line.key, { slot: event.target.value as MealSlot })}>
                        {MEAL_SLOTS.map((slot) => (
                          <option key={slot} value={slot}>
                            {slotLabel(slot)}
                          </option>
                        ))}
                      </Select>
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
                    onClick={() => setDay(day.key, { lines: [...day.lines, { key: key(), slot: 'breakfast', kind: 'recipe', savedMealId: '', amount: '' }] })}
                  >
                    <Plus size={16} /> Recipe
                  </button>
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={!live.length}
                    title={live.length ? undefined : 'You have no foods yet'}
                    onClick={() => setDay(day.key, { lines: [...day.lines, { key: key(), slot: 'breakfast', kind: 'food', savedMealId: '', amount: '' }] })}
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
