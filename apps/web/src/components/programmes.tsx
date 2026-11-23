'use client';

import Link from 'next/link';
import { CalendarCheck, Dumbbell, Pencil, Plus, Share2, Trash2, Utensils, X } from 'lucide-react';
import { useState } from 'react';
import { PROGRAMME_LIMITS, type MealPlan, type PlanList, type Programme, type ProgrammeInput } from '@life-portal/shared-types';
import { programmeProblem } from '@life-portal/shared-domain';
import { api } from '../lib/api';
import { revalidate, useAction, useApi } from '../lib/hooks';
import { mealContextNow } from '../lib/local-day';
import { MealPlanEditor, followPlan } from './meal-plans';
import { PlanEditor } from './training/plan-editor';
import { ErrorNote, Field, Input, Modal, Select, Spinner, Textarea } from './ui';

const KEY = '/programmes';
const MEAL_PLANS_KEY = '/nutrition/meal-plans';
const TRAINING_PLANS_KEY = '/training/plans';

/** The new post page with both halves of a programme attached. */
function postHref(programme: Programme): string {
  const params = new URLSearchParams();
  if (programme.mealPlan) params.set('source', JSON.stringify({ kind: 'mealPlan', mealPlanId: programme.mealPlan.id }));
  if (programme.trainingPlan) params.set('training', JSON.stringify({ kind: 'plan', planId: programme.trainingPlan.id }));
  return `/new?${params.toString()}`;
}

/**
 * Programmes (spec 042): a meal plan and a training plan under one name. Each plan is an
 * ordinary plan in its own library; this is the pairing, so it can be posted and started as
 * one. A person (`canUse`) can start one: its meal plan becomes the plan in use in Food.
 */
export function Programmes({ canUse }: { canUse: boolean }) {
  const programmes = useApi<Programme[]>(KEY);
  const action = useAction();
  const [editing, setEditing] = useState<Programme | 'new' | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const run = (work: () => Promise<unknown>) =>
    action.run(
      async () => {
        await work();
        await Promise.all([revalidate(KEY), revalidate(MEAL_PLANS_KEY), revalidate('/nutrition?')]);
      },
      { revalidate: false },
    );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-ink-muted">Eating and training that go together, under one name.</p>
        <button type="button" className="btn-primary shrink-0" onClick={() => setEditing('new')}>
          <Plus size={16} /> New programme
        </button>
      </div>
      {action.error && <ErrorNote message={action.error} />}
      {note && (
        <p role="status" className="rounded-lg bg-success-solid/10 px-3 py-2 text-sm text-success">
          {note}
        </p>
      )}
      {programmes.error ? (
        <ErrorNote message={(programmes.error as Error).message} />
      ) : !programmes.data ? (
        <Spinner />
      ) : programmes.data.length === 0 ? (
        <p className="card p-6 text-sm text-ink-muted">No programmes yet. A programme pairs a meal plan with a training plan; you can make both while you create it.</p>
      ) : (
        <ul className="space-y-3">
          {programmes.data.map((programme) => {
            const postable = (!programme.mealPlan || programme.mealPlan.complete) && (!programme.trainingPlan || programme.trainingPlan.isOwn) && programme.gone.length === 0;
            return (
              <li key={programme.id} className="card p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="min-w-0 flex-1 font-medium">{programme.name}</p>
                  <div className="flex shrink-0 items-center gap-1">
                    {postable && (
                      <Link href={postHref(programme)} className="btn-ghost" aria-label={`Post ${programme.name}`}>
                        <Share2 size={16} /> Post
                      </Link>
                    )}
                    <button type="button" className="btn-ghost" aria-label={`Edit ${programme.name}`} onClick={() => setEditing(programme)}>
                      <Pencil size={16} />
                    </button>
                    <button
                      type="button"
                      className="btn-ghost"
                      aria-label={`Delete ${programme.name}`}
                      disabled={action.pending}
                      onClick={() => {
                        if (window.confirm(`Delete ${programme.name}? Its meal plan and training plan stay in your libraries.`)) void run(() => api.delete(`${KEY}/${programme.id}`));
                      }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
                {programme.description && <p className="mt-1 whitespace-pre-wrap break-words text-sm text-ink-muted">{programme.description}</p>}
                <ul className="mt-3 space-y-1.5 text-sm">
                  {programme.mealPlan && (
                    <li className="flex items-center gap-2">
                      <Utensils size={15} className="shrink-0 text-accent" aria-hidden />
                      <span className="min-w-0 flex-1 truncate">
                        {programme.mealPlan.name}
                        <span className="ml-2 text-xs text-ink-faint">
                          {programme.mealPlan.dayCount} {programme.mealPlan.dayCount === 1 ? 'day' : 'days'} · about {programme.mealPlan.dailyKcal} kcal a day
                        </span>
                      </span>
                      {programme.mealPlan.activeSince && <span className="shrink-0 rounded-full bg-accent-solid/15 px-2 py-0.5 text-[11px] font-medium text-accent">Following</span>}
                    </li>
                  )}
                  {programme.trainingPlan && (
                    <li className="flex items-center gap-2">
                      <Dumbbell size={15} className="shrink-0 text-accent" aria-hidden />
                      <span className="min-w-0 flex-1 truncate">
                        {programme.trainingPlan.name}
                        <span className="ml-2 text-xs text-ink-faint">
                          {programme.trainingPlan.workoutCount} {programme.trainingPlan.workoutCount === 1 ? 'workout' : 'workouts'} · {programme.trainingPlan.exerciseCount} exercises
                        </span>
                      </span>
                    </li>
                  )}
                  {programme.gone.map((half) => (
                    <li key={half} className="text-xs text-danger">
                      Its {half === 'mealPlan' ? 'meal plan' : 'training plan'} was deleted. Edit the programme to choose another.
                    </li>
                  ))}
                </ul>
                {canUse && (programme.mealPlan || programme.trainingPlan) && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
                    {programme.mealPlan && !programme.mealPlan.activeSince && (
                      <button
                        type="button"
                        className="btn-primary"
                        disabled={action.pending}
                        onClick={() =>
                          void run(async () => {
                            setNote(null);
                            // Starting a programme is following its meal plan, with the same conflict check.
                            const plan = (await api.get<MealPlan[]>(MEAL_PLANS_KEY)).find((each) => each.id === programme.mealPlan?.id);
                            if (!plan || !(await followPlan(plan))) return;
                            setNote(`You are following ${programme.name}. Its meals are in Food → Today${programme.trainingPlan ? ', and its workouts are in Training → Plans' : ''}.`);
                          })
                        }
                      >
                        <CalendarCheck size={16} /> Start this programme
                      </button>
                    )}
                    {programme.mealPlan?.activeSince && (
                      <Link href="/nutrition" className="btn-ghost">
                        Today&apos;s meals
                      </Link>
                    )}
                    {programme.trainingPlan && (
                      <Link href="/training" className="btn-ghost">
                        Its workouts
                      </Link>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {editing !== null && <ProgrammeEditor programme={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

/**
 * Create or edit a programme. Either half can be picked from what already exists or made here:
 * a plan made here is saved to its own library first (Food → Meal plans, Training → Plans), and
 * the programme then points at it.
 */
function ProgrammeEditor({ programme, onClose }: { programme?: Programme; onClose: () => void }) {
  const mealPlans = useApi<MealPlan[]>(MEAL_PLANS_KEY);
  const trainingPlans = useApi<PlanList>(TRAINING_PLANS_KEY);
  const action = useAction();
  const [name, setName] = useState(programme?.name ?? '');
  const [description, setDescription] = useState(programme?.description ?? '');
  const [mealPlanId, setMealPlanId] = useState(programme?.mealPlan?.id ?? '');
  const [trainingPlanId, setTrainingPlanId] = useState(programme?.trainingPlan?.id ?? '');
  const [making, setMaking] = useState<'meal' | 'training' | null>(null);
  const input: ProgrammeInput = { name, description, ...(mealPlanId ? { mealPlanId } : {}), ...(trainingPlanId ? { trainingPlanId } : {}) };
  const problem = programmeProblem(input);
  const save = () =>
    action
      .run(
        async () => {
          await (programme ? api.put(`${KEY}/${programme.id}`, input) : api.post(KEY, input));
          await revalidate(KEY);
        },
        { revalidate: false },
      )
      .then((ok) => ok && onClose());

  if (making === 'meal')
    return (
      <MealPlanEditor
        onClose={() => setMaking(null)}
        onSaved={(plan) => {
          setMealPlanId(plan.id);
          if (!name.trim()) setName(plan.name);
        }}
      />
    );
  if (making === 'training')
    return (
      <div className="fixed inset-0 z-[60] flex flex-col bg-surface" role="dialog" aria-modal="true" aria-label="New training plan" data-no-tab-swipe>
        <header className="flex items-center gap-2 border-b border-border px-2 pb-2 pt-[calc(var(--top-chrome)+0.5rem)]">
          <button type="button" aria-label="Back to the programme" className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-ink/5" onClick={() => setMaking(null)}>
            <X size={22} />
          </button>
          <h2 className="flex-1 text-center text-base font-semibold">New training plan</h2>
          <span className="h-10 w-10" />
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3">
          <PlanEditor
            onDone={(id) => {
              if (id) {
                setTrainingPlanId(id);
                void revalidate(TRAINING_PLANS_KEY);
              }
              setMaking(null);
            }}
          />
        </div>
      </div>
    );

  const ownTraining = trainingPlans.data?.own ?? [];
  const sharedTraining = trainingPlans.data?.shared ?? [];
  return (
    <Modal open onClose={onClose} title={programme ? 'Edit programme' : 'New programme'} wide>
      {!mealPlans.data || !trainingPlans.data ? (
        <Spinner />
      ) : (
        <div className="space-y-4">
          <Field label="Name">
            <Input value={name} maxLength={PROGRAMME_LIMITS.name} placeholder="8-week lean bulk" onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label="What it is for" hint="Optional.">
            <Textarea rows={2} maxLength={PROGRAMME_LIMITS.description} value={description} onChange={(event) => setDescription(event.target.value)} />
          </Field>

          <section className="space-y-2 rounded-xl border border-border p-3">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <Utensils size={15} className="text-accent" aria-hidden /> Meal plan
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Select aria-label="Meal plan" className="min-w-[10rem] flex-1" value={mealPlanId} onChange={(event) => setMealPlanId(event.target.value)}>
                <option value="">None</option>
                {mealPlans.data.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.name}
                  </option>
                ))}
              </Select>
              <button type="button" className="btn-ghost shrink-0" onClick={() => setMaking('meal')}>
                <Plus size={16} /> New
              </button>
            </div>
          </section>

          <section className="space-y-2 rounded-xl border border-border p-3">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <Dumbbell size={15} className="text-accent" aria-hidden /> Training plan
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Select aria-label="Training plan" className="min-w-[10rem] flex-1" value={trainingPlanId} onChange={(event) => setTrainingPlanId(event.target.value)}>
                <option value="">None</option>
                {ownTraining.length > 0 && (
                  <optgroup label="Mine">
                    {ownTraining.map((plan) => (
                      <option key={plan.id} value={plan.id}>
                        {plan.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                {sharedTraining.length > 0 && (
                  <optgroup label="Ready-made (cannot be posted)">
                    {sharedTraining.map((plan) => (
                      <option key={plan.id} value={plan.id}>
                        {plan.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </Select>
              <button type="button" className="btn-ghost shrink-0" onClick={() => setMaking('training')}>
                <Plus size={16} /> New
              </button>
            </div>
          </section>

          <p className="text-xs text-ink-faint">A plan you make here is saved to your meal plans or training plans like any other, and stays there if the programme is deleted.</p>
          {action.error && <ErrorNote message={action.error} />}
          <div className="flex items-center justify-end gap-2">
            {problem && name.trim() && <p className="mr-auto text-xs text-ink-muted">{problem}</p>}
            <button type="button" className="btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn-primary" disabled={!!problem || action.pending} onClick={() => void save()}>
              {action.pending ? 'Saving…' : 'Save programme'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
