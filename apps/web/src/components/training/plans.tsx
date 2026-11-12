'use client';

import { useState } from 'react';
import { mutate } from 'swr';
import { ChevronLeft, ChevronRight, Copy, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import type { PlanDetail as PlanDetailData, PlanList, PlanListItem, SessionDetail } from '@life-portal/shared-types';
import clsx from 'clsx';
import { supersetRuns } from '@life-portal/shared-domain';
import { EmptyState, ErrorNote, Spinner } from '../ui';
import { GROUP_STYLES, planGroup, usePlanStyle } from '../../lib/training-colors';
import { api, ApiError } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import {
  PLANS_KEY,
  describeTarget,
  formatDuration,
  planKey,
  revalidateTraining,
  useWeightUnit,
  useWorkoutDay,
} from '../../lib/training';
import { PlanEditor } from './plan-editor';
import { lastDoneLabel } from './plan-suggestions';

type View = { kind: 'list' } | { kind: 'plan'; id: string } | { kind: 'edit'; id?: string };

/**
 * The Plans tab (spec 023): ready-made plans and the person's own, and one plan's workouts with
 * a Start for each. Starting opens the Workout tab with the plan's sets as suggestions. Own plans
 * are created, copied, edited and deleted here (US2).
 */
export function Plans({ onStarted }: { onStarted: () => void }) {
  const [view, setView] = useState<View>({ kind: 'list' });
  const toList = () => setView({ kind: 'list' });
  if (view.kind === 'edit') {
    return view.id ? (
      <EditPlan id={view.id} onDone={(id) => setView(id ? { kind: 'plan', id } : { kind: 'list' })} />
    ) : (
      <PlanEditor onDone={(id) => setView(id ? { kind: 'plan', id } : { kind: 'list' })} />
    );
  }
  if (view.kind === 'plan') {
    return (
      <PlanView
        id={view.id}
        onBack={toList}
        onStarted={onStarted}
        onEdit={(id) => setView({ kind: 'edit', id })}
        onDeleted={toList}
      />
    );
  }
  return <PlansList onOpen={(id) => setView({ kind: 'plan', id })} onNew={() => setView({ kind: 'edit' })} />;
}

function EditPlan({ id, onDone }: { id: string; onDone: (id?: string) => void }) {
  const { data, error, isLoading } = useApi<PlanDetailData>(planKey(id));
  if (isLoading) return <Spinner />;
  if (error) return <ErrorNote message={(error as Error).message} />;
  if (!data) return null;
  return <PlanEditor plan={data} onDone={onDone} />;
}

function PlansList({ onOpen, onNew }: { onOpen: (id: string) => void; onNew: () => void }) {
  const { data, error, isLoading } = useApi<PlanList>(PLANS_KEY);
  if (isLoading) return <Spinner />;
  if (error) return <ErrorNote message={(error as Error).message} />;
  if (!data) return null;
  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-muted">My plans</h2>
          <button type="button" className="btn-primary" onClick={onNew}>
            <Plus className="h-4 w-4" /> New plan
          </button>
        </div>
        {data.own.length ? (
          <PlanCards plans={data.own} onOpen={onOpen} />
        ) : (
          <button
            type="button"
            onClick={onNew}
            className="flex w-full items-center gap-3 rounded-2xl border-2 border-dashed border-accent/40 bg-accent/5 p-4 text-left text-sm"
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent-solid text-on-accent">
              <Plus className="h-5 w-5" />
            </span>
            <span className="min-w-0">
              <span className="block font-semibold">Make your own plan</span>
              <span className="block text-xs text-ink-muted">Or copy a ready-made one below and change it.</span>
            </span>
          </button>
        )}
      </section>
      <section className="space-y-2">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-muted">Ready-made plans</h2>
          <p className="text-xs text-ink-faint">Written for this app. Copy one to change it.</p>
        </div>
        {data.shared.length ? (
          <PlanCards plans={data.shared} shared onOpen={onOpen} />
        ) : (
          <EmptyState message="No ready-made plans yet." />
        )}
      </section>
    </div>
  );
}

/** Plans as colourful cards: ready-made ones take colours in order, own ones from their id. */
function PlanCards({ plans, shared = false, onOpen }: { plans: PlanListItem[]; shared?: boolean; onOpen: (id: string) => void }) {
  const today = useWorkoutDay()();
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {plans.map((plan, index) => {
        const style = GROUP_STYLES[planGroup(plan.id, shared ? index : undefined)];
        const Icon = style.icon;
        return (
          <li key={plan.id}>
            <button
              type="button"
              onClick={() => onOpen(plan.id)}
              className={clsx(
                'relative flex h-full w-full flex-col overflow-hidden rounded-2xl bg-gradient-to-br p-4 text-left text-white shadow-md',
                style.gradient,
              )}
            >
              <span aria-hidden className="pointer-events-none absolute -right-6 -top-8 h-24 w-24 rounded-full bg-white/10" />
              <span className="relative flex items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/20">
                  <Icon className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{plan.name}</span>
                  <span className="block truncate text-xs text-white/80">
                    {plan.workoutCount} {plan.workoutCount === 1 ? 'workout' : 'workouts'} · {plan.exerciseCount} exercises
                  </span>
                </span>
                <ChevronRight className="h-5 w-5 shrink-0 text-white/80" />
              </span>
              {plan.description && !plan.lastDoneDay && (
                <span className="relative mt-2 line-clamp-2 text-xs text-white/85">{plan.description}</span>
              )}
              {plan.lastDoneDay && (
                <span className="relative mt-3 flex flex-wrap items-center gap-2 text-xs">
                  {plan.nextWorkout && (
                    <span className="max-w-full truncate rounded-full bg-white/25 px-2 py-0.5 font-semibold">
                      Next: {plan.nextWorkout.name}
                    </span>
                  )}
                  <span className="text-white/85">{lastDoneLabel(plan.lastDoneDay, today)}</span>
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function PlanView({
  id,
  onBack,
  onStarted,
  onEdit,
  onDeleted,
}: {
  id: string;
  onBack: () => void;
  onStarted: () => void;
  onEdit: (id: string) => void;
  onDeleted: () => void;
}) {
  const { data, error, isLoading } = useApi<PlanDetailData>(planKey(id));
  const [busy, setBusy] = useState<'copy' | 'delete' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // A copy is for changing, so it opens straight in the editor.
  const copy = async () => {
    setBusy('copy');
    setActionError(null);
    try {
      const created = await api.post<PlanDetailData>(`/training/plans/${id}/copy`, { requestId: crypto.randomUUID() });
      await Promise.all([mutate(PLANS_KEY), mutate(planKey(created.id), created, { revalidate: false })]);
      onEdit(created.id);
    } catch (caught) {
      setActionError(caught instanceof ApiError ? caught.message : 'Could not reach the server. Try again.');
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!data || !window.confirm(`Delete ${data.name}? Workouts you did from it stay in your history.`)) return;
    setBusy('delete');
    setActionError(null);
    try {
      await api.delete(`/training/plans/${id}`);
      await mutate(PLANS_KEY);
      onDeleted();
    } catch (caught) {
      setActionError(caught instanceof ApiError ? caught.message : 'Could not reach the server. Try again.');
      setBusy(null);
    }
  };
  const unit = useWeightUnit();
  const workoutDay = useWorkoutDay();
  const style = usePlanStyle(id);
  const PlanIcon = style.icon;
  const [starting, setStarting] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [inProgress, setInProgress] = useState<string | null>(null);

  const start = async (planWorkoutId: string) => {
    setStarting(planWorkoutId);
    setStartError(null);
    setInProgress(null);
    try {
      const session = await api.post<SessionDetail>('/training/sessions', {
        requestId: crypto.randomUUID(),
        day: workoutDay(),
        planId: id,
        planWorkoutId,
      });
      await revalidateTraining();
      // One open workout per person: a start while one is open resumes it instead (FR-017).
      if (session.resumed) {
        setInProgress(session.plan ? `${session.plan.workoutName} · ${session.plan.planName}` : 'Another workout');
        return;
      }
      onStarted();
    } catch (caught) {
      setStartError(caught instanceof ApiError ? caught.message : 'Could not reach the server. Try again.');
    } finally {
      setStarting(null);
    }
  };

  return (
    <div className="space-y-3">
      <button type="button" className="btn-ghost" onClick={onBack}>
        <ChevronLeft className="h-4 w-4" /> All plans
      </button>
      {isLoading && <Spinner />}
      {error && <ErrorNote message={(error as Error).message} />}
      {data && (
        <>
          <section
            className={clsx(
              'relative overflow-hidden rounded-2xl bg-gradient-to-br p-4 text-white shadow-lg sm:p-5',
              style.gradient,
            )}
          >
            <div aria-hidden className="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-white/10" />
            <div className="relative">
              <div className="flex items-start gap-3">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/20">
                  <PlanIcon className="h-6 w-6" />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="text-lg font-bold leading-tight">{data.name}</h2>
                  <p className="mt-0.5 text-xs text-white/80">
                    {data.workouts.length} {data.workouts.length === 1 ? 'workout' : 'workouts'}
                    {data.copiedFrom ? ` · based on ${data.copiedFrom.name}` : ''}
                  </p>
                </div>
              </div>
              {data.description && <p className="mt-3 text-sm text-white/90">{data.description}</p>}
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-white/20 px-3 text-sm font-medium hover:bg-white/30 disabled:opacity-60"
                  disabled={busy !== null}
                  onClick={() => void copy()}
                >
                  <Copy className="h-4 w-4" /> {busy === 'copy' ? 'Copying…' : 'Copy'}
                </button>
                {data.isOwn && (
                  <>
                    <button
                      type="button"
                      className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-white/20 px-3 text-sm font-medium hover:bg-white/30 disabled:opacity-60"
                      disabled={busy !== null}
                      onClick={() => onEdit(id)}
                    >
                      <Pencil className="h-4 w-4" /> Edit
                    </button>
                    <button
                      type="button"
                      className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-white/20 hover:bg-white/30 disabled:opacity-60"
                      disabled={busy !== null}
                      onClick={() => void remove()}
                      aria-label="Delete plan"
                      title="Delete plan"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </>
                )}
              </div>
            </div>
          </section>
          {actionError && <ErrorNote message={actionError} />}
          {inProgress && (
            <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-ink">
              <p>{inProgress} is still in progress. Finish or discard it before starting another.</p>
              <button type="button" className="btn-ghost" onClick={onStarted}>
                Open it
              </button>
            </div>
          )}
          {startError && <ErrorNote message={startError} />}
          {!inProgress && !startError && (
            <p className="px-1 text-xs text-ink-faint">
              Start a workout and its sets appear as suggestions. Weights come from your last time, or stay empty
              for you to fill in.
            </p>
          )}
          {data.workouts.map((workout, index) => {
            const next = workout.isNext && data.workouts.length > 1;
            return (
              <section
                key={workout.id}
                className={clsx('card border-l-4 p-4', style.edge, next && 'ring-2 ring-accent/40')}
              >
                <div className="flex items-start gap-3">
                  <span
                    className={clsx(
                      'grid h-10 w-10 shrink-0 place-items-center rounded-xl text-lg font-bold',
                      style.solid,
                    )}
                    aria-hidden
                  >
                    {String.fromCharCode(65 + (index % 26))}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate font-semibold">{workout.name}</h3>
                      {next && (
                        <span className="rounded-full bg-accent-solid px-2 py-0.5 text-[11px] font-semibold text-on-accent">
                          Next
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-ink-faint">
                      {workout.exercises.length} exercises · {lastDoneLabel(workout.lastDoneDay, workoutDay())}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn-primary shrink-0"
                    disabled={starting !== null || !workout.exercises.length}
                    title={workout.exercises.length ? undefined : 'This workout has no exercises yet'}
                    onClick={() => void start(workout.id)}
                  >
                    <Play className="h-4 w-4" /> {starting === workout.id ? 'Starting…' : 'Start'}
                  </button>
                </div>
                {workout.exercises.length ? (
                  <ol className="mt-3 space-y-2">
                    {workout.exercises.map((exercise, position) => {
                      const place = supersetRuns(workout.exercises).get(exercise.id);
                      return (
                      <li key={exercise.id} className="flex gap-3 text-sm">
                        <span
                          className={clsx(
                            'grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold',
                            place ? 'bg-train-pull-solid text-white' : clsx(style.tint, style.text),
                          )}
                          title={place ? `Superset ${place.label}` : undefined}
                        >
                          {place ? `${place.label}${place.position}` : position + 1}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium">
                            {exercise.exercise.name}
                            {exercise.exercise.archived && <span className="ml-2 text-xs text-ink-faint">archived</span>}
                          </span>
                          <span className="block text-xs text-ink-faint">
                            {summariseTargets(exercise.targets.map((target) => describeTarget(exercise.exercise.measure, target, unit)))}
                            {exercise.restSeconds != null ? ` · rest ${formatDuration(exercise.restSeconds)}` : ''}
                            {exercise.note ? ` · ${exercise.note}` : ''}
                          </span>
                        </span>
                      </li>
                      );
                    })}
                  </ol>
                ) : (
                  <p className="mt-3 text-sm text-ink-faint">No exercises in this workout yet.</p>
                )}
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}

/** `['8–12 reps', '8–12 reps', '8–12 reps']` → `3 × 8–12 reps`; mixed sets are listed in order. */
export function summariseTargets(parts: string[]): string {
  const groups: { text: string; count: number }[] = [];
  for (const text of parts) {
    const last = groups[groups.length - 1];
    if (last && last.text === text) last.count++;
    else groups.push({ text, count: 1 });
  }
  return groups.map((group) => (group.count > 1 ? `${group.count} × ${group.text}` : group.text)).join(', ');
}
