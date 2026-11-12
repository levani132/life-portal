'use client';

import { useState } from 'react';
import { mutate } from 'swr';
import { ChevronLeft, ChevronRight, Copy, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import type { PlanDetail as PlanDetailData, PlanList, PlanListItem, SessionDetail } from '@life-portal/shared-types';
import { EmptyState, ErrorNote, Panel, Spinner } from '../ui';
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
    <div className="space-y-4">
      <Panel
        title="My plans"
        actions={
          <button type="button" className="btn-primary" onClick={onNew}>
            <Plus className="h-4 w-4" /> New plan
          </button>
        }
      >
        {data.own.length ? (
          <PlanRows plans={data.own} onOpen={onOpen} />
        ) : (
          <EmptyState message="No plans of your own yet. Make one, or copy a ready-made plan and change it." />
        )}
      </Panel>
      <Panel title="Ready-made plans" description="Written for this app. Copy one to change it.">
        {data.shared.length ? <PlanRows plans={data.shared} onOpen={onOpen} /> : <EmptyState message="No ready-made plans yet." />}
      </Panel>
    </div>
  );
}

function PlanRows({ plans, onOpen }: { plans: PlanListItem[]; onOpen: (id: string) => void }) {
  return (
    <ul className="divide-y divide-border">
      {plans.map((plan) => (
        <li key={plan.id}>
          <button type="button" className="flex w-full items-center gap-3 py-3 text-left" onClick={() => onOpen(plan.id)}>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{plan.name}</span>
              <span className="block truncate text-xs text-ink-faint">
                {plan.workoutCount} {plan.workoutCount === 1 ? 'workout' : 'workouts'} · {plan.exerciseCount} exercises
                {plan.description ? ` · ${plan.description}` : ''}
              </span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-ink-faint" />
          </button>
        </li>
      ))}
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
          <Panel
            title={data.name}
            description={data.description}
          >
            <div className="-mt-1 mb-3 flex flex-wrap items-center gap-2">
                <button type="button" className="btn-ghost" disabled={busy !== null} onClick={() => void copy()}>
                  <Copy className="h-4 w-4" /> {busy === 'copy' ? 'Copying…' : 'Copy'}
                </button>
                {data.isOwn && (
                  <>
                    <button type="button" className="btn-ghost" disabled={busy !== null} onClick={() => onEdit(id)}>
                      <Pencil className="h-4 w-4" /> Edit
                    </button>
                    <button
                      type="button"
                      className="btn-ghost px-2"
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
            {data.copiedFrom && <p className="mb-2 text-xs text-ink-faint">Based on {data.copiedFrom.name}</p>}
            {actionError && <ErrorNote message={actionError} />}
            {inProgress && (
              <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
                <p>{inProgress} is still in progress. Finish or discard it before starting another.</p>
                <button type="button" className="btn-ghost" onClick={onStarted}>
                  Open it
                </button>
              </div>
            )}
            {startError && <ErrorNote message={startError} />}
            {!inProgress && !startError && (
              <p className="text-xs text-ink-faint">
                Start a workout and its sets appear as suggestions. Weights come from your last time, or stay
                empty for you to fill in.
              </p>
            )}
          </Panel>
          {data.workouts.map((workout) => (
            <Panel
              key={workout.id}
              title={workout.name}
              description={`${workout.exercises.length} exercises`}
              actions={
                <button
                  type="button"
                  className="btn-primary"
                  disabled={starting !== null || !workout.exercises.length}
                  title={workout.exercises.length ? undefined : 'This workout has no exercises yet'}
                  onClick={() => void start(workout.id)}
                >
                  <Play className="h-4 w-4" /> {starting === workout.id ? 'Starting…' : 'Start'}
                </button>
              }
            >
              {workout.exercises.length ? (
                <ol className="space-y-2">
                  {workout.exercises.map((exercise) => (
                    <li key={exercise.id} className="text-sm">
                      <span className="block font-medium">
                        {exercise.exercise.name}
                        {exercise.exercise.archived && <span className="ml-2 text-xs text-ink-faint">archived</span>}
                      </span>
                      <span className="block text-xs text-ink-faint">
                        {summariseTargets(exercise.targets.map((target) => describeTarget(exercise.exercise.measure, target, unit)))}
                        {exercise.restSeconds != null ? ` · rest ${formatDuration(exercise.restSeconds)}` : ''}
                        {exercise.note ? ` · ${exercise.note}` : ''}
                      </span>
                    </li>
                  ))}
                </ol>
              ) : (
                <EmptyState message="No exercises in this workout yet." />
              )}
            </Panel>
          ))}
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
