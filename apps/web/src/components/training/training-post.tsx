'use client';

import clsx from 'clsx';
import { useState } from 'react';
import { mutate } from 'swr';
import { ClipboardList, Clock, Copy, Dumbbell, Trophy } from 'lucide-react';
import {
  PLAN_LIMITS,
  type PlanList,
  type PlanTarget,
  type PortalState,
  type PublishedSet,
  type TrainingAttachment,
  type TrainingCopyPreview,
  type TrainingCopyResult,
  type TrainingProfile,
  type WeightUnit,
} from '@life-portal/shared-types';
import { copyNeedsPlanChoice, formatDay } from '@life-portal/shared-domain';
import { api, ApiError, NetworkError } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import { PLANS_KEY, PROFILE_KEY, RECORD_LABELS, formatDuration, formatRecordValue, formatWeight } from '../../lib/training';
import { GROUP_STYLES, exerciseGroup } from '../../lib/training-colors';
import { Field, Input, Modal, Select } from '../ui';
import { MuscleFigure, hasMuscleFigure } from './muscle-figure';

type Published = TrainingAttachment['exercises'][number];

/** The viewer's weight unit. A viewer without Training has no training profile: kilograms. */
function useViewerUnit(): WeightUnit {
  const portal = useApi<PortalState>('/portal');
  const profile = useApi<TrainingProfile>(portal.data?.access.training ? PROFILE_KEY : null);
  return profile.data?.weightUnit ?? 'kg';
}

/** `8–12 reps`, `60 kg × 8`, `1:30`: one planned or logged set, in words. */
function setText(set: PlanTarget | PublishedSet, unit: WeightUnit): string {
  const parts: string[] = [];
  if (set.reps != null) {
    const reps = 'repsMax' in set && set.repsMax != null ? `${set.reps}–${set.repsMax}` : String(set.reps);
    parts.push(set.weightGrams != null ? `${formatWeight(set.weightGrams, unit)} × ${reps}` : `${reps} reps`);
  } else if (set.weightGrams != null) parts.push(formatWeight(set.weightGrams, unit));
  if (set.assistGrams != null) parts.push(`${formatWeight(set.assistGrams, unit)} assist`);
  if (set.distanceMeters != null) parts.push(set.distanceMeters >= 1000 ? `${(set.distanceMeters / 1000).toFixed(set.distanceMeters % 1000 ? 1 : 0)} km` : `${set.distanceMeters} m`);
  if (set.durationSeconds != null) parts.push(formatDuration(set.durationSeconds));
  return parts.join(' · ') || 'Set';
}

/** Sets that read the same, collapsed: `3 × 8 reps`. */
function grouped(sets: readonly (PlanTarget | PublishedSet)[], unit: WeightUnit): string {
  const out: { text: string; count: number }[] = [];
  for (const set of sets) {
    const text = `${set.type === 'warmup' ? 'Warm-up ' : ''}${setText(set, unit)}`;
    const last = out[out.length - 1];
    if (last?.text === text) last.count += 1;
    else out.push({ text, count: 1 });
  }
  return out.map((row) => (row.count > 1 ? `${row.count} × ${row.text}` : row.text)).join(', ');
}

function ExerciseLine({ exercise, detail, record }: { exercise: Published; detail: string; record?: string }) {
  const style = GROUP_STYLES[exerciseGroup(exercise.primaryMuscles, exercise.measure)];
  const Icon = style.icon;
  return (
    <li className="flex items-center gap-2.5 rounded-xl bg-surface-raised px-2.5 py-2">
      <span className={clsx('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', style.tint, style.text)} aria-hidden>
        {exercise.measure !== 'distance_duration' && hasMuscleFigure(exercise.primaryMuscles) ? (
          <MuscleFigure
            muscles={exercise.primaryMuscles}
            lit="currentColor"
            dim="color-mix(in srgb, currentColor 30%, rgb(var(--surface-raised)))"
            gap="rgb(var(--surface-raised))"
            className="h-[30px] w-[30px]"
          />
        ) : (
          <Icon className="h-4 w-4" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{exercise.name}</span>
        <span className="block truncate text-xs text-ink-faint">{detail}</span>
      </span>
      {record && (
        <span className="flex shrink-0 items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
          <Trophy className="h-3 w-3" aria-hidden /> {record}
        </span>
      )}
    </li>
  );
}

/** The muscles a list of exercises works, one small figure each, in the order first met. */
function MuscleIcons({ exercises, max = 6 }: { exercises: readonly Published[]; max?: number }) {
  const seen = new Set<string>();
  const unique = exercises.filter((exercise) => {
    const key = exercise.measure === 'distance_duration' ? 'cardio' : (exercise.primaryMuscles[0] ?? 'other');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return (
    <span className="flex shrink-0 items-center gap-1" aria-hidden>
      {unique.slice(0, max).map((exercise) => {
        const style = GROUP_STYLES[exerciseGroup(exercise.primaryMuscles, exercise.measure)];
        const Icon = style.icon;
        return (
          <span key={exercise.key} className={clsx('flex h-7 w-7 items-center justify-center rounded-lg', style.tint, style.text)}>
            {exercise.measure !== 'distance_duration' && hasMuscleFigure(exercise.primaryMuscles) ? (
              <MuscleFigure
                muscles={exercise.primaryMuscles}
                lit="currentColor"
                dim="color-mix(in srgb, currentColor 30%, rgb(var(--surface-raised)))"
                gap="rgb(var(--surface-raised))"
                className="h-[23px] w-[23px]"
              />
            ) : (
              <Icon className="h-3.5 w-3.5" />
            )}
          </span>
        );
      })}
      {unique.length > max && <span className="text-[11px] text-ink-faint">+{unique.length - max}</span>}
    </span>
  );
}

/** How many plan days a feed card shows before it fades out. */
const FEED_DAYS = 3;

/**
 * The attachment on a feed card: a summary, not the whole thing. A plan is its days by name, each
 * with the muscles it works; past a few days the list fades out, which says there is more behind
 * "Open post". A workout is its figures and the muscles worked. Nothing here is not also in the
 * full view.
 */
function CompactAttachment({ training }: { training: TrainingAttachment }) {
  const byKey = new Map(training.exercises.map((exercise) => [exercise.key, exercise]));
  const of = (keys: readonly string[]) => keys.flatMap((key) => byKey.get(key) ?? []);
  const { workout, plan } = training;
  if (workout) {
    const sets = workout.exercises.reduce((sum, row) => sum + row.setTypes.length, 0);
    const names = of(workout.exercises.map((row) => row.key)).map((exercise) => exercise.name);
    return (
      <div className="space-y-2">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
          <span>{formatDay(workout.day)}</span>
          <span className="flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" aria-hidden /> {formatDuration(workout.durationSeconds)}
          </span>
          <span>
            {workout.exercises.length} exercise{workout.exercises.length === 1 ? '' : 's'} · {sets} sets
          </span>
          {!!workout.records?.length && (
            <span className="flex items-center gap-1 font-semibold text-amber-600 dark:text-amber-400">
              <Trophy className="h-3.5 w-3.5" aria-hidden /> {workout.records.length} record{workout.records.length === 1 ? '' : 's'}
            </span>
          )}
        </p>
        <MuscleIcons exercises={of(workout.exercises.map((row) => row.key))} max={8} />
        <p className="line-clamp-2 text-xs text-ink-faint">{names.join(' · ')}</p>
      </div>
    );
  }
  if (plan) {
    const more = plan.workouts.length > FEED_DAYS;
    return (
      <div className="space-y-2">
        <p className="text-xs text-ink-muted">
          {plan.includedWorkouts < plan.totalWorkouts
            ? `${plan.includedWorkouts} of ${plan.totalWorkouts} workouts`
            : `${plan.workouts.length} workout${plan.workouts.length === 1 ? '' : 's'}`}
        </p>
        <div className="relative">
          <ul className="space-y-1.5">
            {/* One more than the limit, half hidden under the fade: the list visibly continues. */}
            {plan.workouts.slice(0, FEED_DAYS + 1).map((day, index) => (
              <li key={index} className="flex items-center gap-2.5 rounded-xl bg-surface-raised px-2.5 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{day.name}</span>
                  <span className="block text-xs text-ink-faint">
                    {day.exercises.length} exercise{day.exercises.length === 1 ? '' : 's'}
                  </span>
                </span>
                <MuscleIcons exercises={of(day.exercises.map((row) => row.key))} max={4} />
              </li>
            ))}
          </ul>
          {more && (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-surface via-surface/80 to-transparent"
            />
          )}
        </div>
        {more && <p className="text-xs text-ink-faint">{plan.workouts.length - FEED_DAYS} more in the post</p>}
      </div>
    );
  }
  return null;
}

/**
 * A post's Training attachment (spec 036), as its viewers see it: exactly the published snapshot,
 * nothing read from anyone's training data. Used by the post card and by the composer's preview,
 * so what the author previews is what is shown. `compact` is the feed's summary of the same thing.
 */
export function TrainingAttachmentView({ training, compact = false }: { training: TrainingAttachment; compact?: boolean }) {
  const unit = useViewerUnit();
  const byKey = new Map(training.exercises.map((exercise) => [exercise.key, exercise]));
  const { workout, plan } = training;
  const single = training.exercise ? byKey.get(training.exercise.key) : undefined;
  return (
    <div className="space-y-3" data-training-kind={training.kind}>
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-train-pull-solid to-train-arms-solid text-white">
          {training.kind === 'plan' ? <ClipboardList className="h-5 w-5" /> : <Dumbbell className="h-5 w-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            {training.kind === 'workout' ? 'Workout' : training.kind === 'plan' ? 'Plan' : 'Exercise'}
          </p>
          <p className="truncate text-sm font-semibold">{training.label}</p>
        </div>
      </div>

      {compact && !single && <CompactAttachment training={training} />}

      {workout && !compact && (
        <>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
            <span>{formatDay(workout.day)}</span>
            <span className="flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" aria-hidden /> {formatDuration(workout.durationSeconds)}
            </span>
            <span>
              {workout.exercises.length} exercise{workout.exercises.length === 1 ? '' : 's'} ·{' '}
              {workout.exercises.reduce((sum, row) => sum + row.setTypes.length, 0)} sets
            </span>
          </p>
          <ul className="space-y-1.5">
            {workout.exercises.map((row, index) => {
              const exercise = byKey.get(row.key);
              if (!exercise) return null;
              const record = workout.records?.find((item) => item.key === row.key);
              return (
                <ExerciseLine
                  key={`${row.key}-${index}`}
                  exercise={exercise}
                  detail={row.logged ? grouped(row.logged, unit) : `${row.setTypes.length} set${row.setTypes.length === 1 ? '' : 's'}`}
                  record={record ? `${RECORD_LABELS[record.kind]}: ${formatRecordValue({ ...record, setId: '', sessionId: '', day: workout.day }, unit)}` : undefined}
                />
              );
            })}
          </ul>
        </>
      )}

      {plan && !compact && (
        <>
          {plan.description && <p className="whitespace-pre-wrap text-xs text-ink-muted">{plan.description}</p>}
          {plan.includedWorkouts < plan.totalWorkouts && (
            <p className="rounded-lg bg-ink/5 px-2.5 py-1.5 text-xs text-ink-muted">
              {plan.includedWorkouts} of {plan.totalWorkouts} workouts. This is part of a larger plan.
            </p>
          )}
          {plan.workouts.map((day, index) => (
            <section key={index} aria-label={day.name}>
              <h4 className="mb-1.5 text-xs font-bold">{day.name}</h4>
              <ul className="space-y-1.5">
                {day.exercises.map((row, position) => {
                  const exercise = byKey.get(row.key);
                  return exercise ? (
                    <ExerciseLine key={`${row.key}-${position}`} exercise={exercise} detail={[grouped(row.targets, unit), row.note].filter(Boolean).join(' · ')} />
                  ) : null;
                })}
              </ul>
            </section>
          ))}
        </>
      )}

      {single && (
        <>
          {single.image && (
            <img
              src={single.image.url}
              alt=""
              width={single.image.width}
              height={single.image.height}
              className="max-h-72 w-full rounded-xl object-cover"
            />
          )}
          <ul>
            <ExerciseLine
              exercise={single}
              detail={[...single.primaryMuscles, ...(single.secondaryMuscles ?? [])].map((muscle) => muscle.replace(/_/g, ' ')).join(', ')}
            />
          </ul>
          {!compact && !!single.instructions?.length && (
            <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-muted">
              {single.instructions.map((step, index) => (
                <li key={index}>{step}</li>
              ))}
            </ol>
          )}
        </>
      )}
    </div>
  );
}

const NEW_PLAN = '';

/**
 * Copies a post's Training attachment into the viewer's own data. A whole plan and an exercise
 * are one tap; a single workout asks where it goes, as saving one's own workout to a plan does.
 * Nothing is started or logged.
 */
export function CopyTrainingSheet({ postId, training, onClose, onCopied }: { postId: string; training: TrainingAttachment; onClose: () => void; onCopied?: (result: TrainingCopyResult) => void }) {
  const preview = useApi<TrainingCopyPreview>(`/posts/${postId}/training-copy`);
  const needsPlan = copyNeedsPlanChoice(training);
  const { data: plans } = useApi<PlanList>(needsPlan ? PLANS_KEY : null);
  const own = plans?.own ?? [];
  // One id per sheet, so a retried tap never copies twice.
  const [requestId] = useState(() => crypto.randomUUID());
  const [picked, setPicked] = useState<string | null>(null);
  const [planName, setPlanName] = useState(training.label.slice(0, PLAN_LIMITS.name));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<TrainingCopyResult | null>(null);

  const isFull = (count: number) => count >= PLAN_LIMITS.workouts;
  const planId = picked ?? own.find((plan) => !isFull(plan.workoutCount))?.id ?? NEW_PLAN;
  const existing = done ?? preview.data?.existing;
  const what = training.kind === 'exercise' ? 'exercise' : needsPlan ? 'workout' : 'plan';

  const copy = async () => {
    if (needsPlan && planId === NEW_PLAN && !planName.trim()) {
      setError('The plan needs a name.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await api.post<TrainingCopyResult>(`/posts/${postId}/training-copy`, {
        requestId,
        ...(needsPlan ? (planId === NEW_PLAN ? { planName: planName.trim() } : { planId }) : {}),
      });
      await Promise.all([
        mutate((key) => typeof key === 'string' && (key.startsWith('/training/plans') || key.startsWith('/training/exercises'))),
        preview.mutate(),
      ]);
      setDone(result);
      onCopied?.(result);
    } catch (caught) {
      if (caught instanceof NetworkError) setError('Copying needs a connection. Try again when you are back online.');
      else setError(caught instanceof ApiError ? caught.message : 'Could not copy. Try again.');
    } finally {
      setPending(false);
    }
  };

  if (existing) {
    return (
      <Modal open onClose={onClose} title={done && !done.reused ? 'Copied' : 'Already copied'}>
        <p className="text-sm text-ink-muted">
          {existing.exerciseId
            ? 'This exercise is among your own exercises.'
            : existing.planWorkoutId
              ? 'This workout is in one of your plans.'
              : 'This plan is among your own plans.'}{' '}
          Nothing was started or logged.
        </p>
        <a className="btn-primary w-full justify-center" href="/training">
          Open Training
        </a>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Copy this ${what}`}
      onSubmit={() => void copy()}
      submitLabel={needsPlan ? (planId === NEW_PLAN ? 'Create plan' : 'Add to plan') : `Copy ${what}`}
      pending={pending}
      error={error ?? (preview.error ? (preview.error as Error).message : null)}
    >
      {needsPlan && (
        <>
          <Field label="Plan">
            <Select value={planId} onChange={(event) => setPicked(event.target.value)}>
              {own.map((item) => (
                <option key={item.id} value={item.id} disabled={isFull(item.workoutCount)}>
                  {item.name}
                  {isFull(item.workoutCount) ? ' (full)' : ''}
                </option>
              ))}
              <option value={NEW_PLAN}>New plan…</option>
            </Select>
          </Field>
          {planId === NEW_PLAN && (
            <Field label="Plan name">
              <Input value={planName} maxLength={PLAN_LIMITS.name} onChange={(event) => setPlanName(event.target.value)} />
            </Field>
          )}
        </>
      )}
      {!!preview.data?.newExercises.length && (
        <p className="text-xs text-ink-muted">
          Also adds to your own exercises: {preview.data.newExercises.join(', ')}.
        </p>
      )}
      <p className="text-xs text-ink-faint">
        {training.kind === 'workout'
          ? 'You get its exercises and sets as a plan workout, without their weights. '
          : ''}
        It becomes yours to edit, and says who it came from. Nothing is started or logged.
      </p>
    </Modal>
  );
}

/** The Copy action on a post that allows it. */
export function CopyTrainingButton({ postId, training }: { postId: string; training: TrainingAttachment }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn-ghost mt-3 w-full justify-center" onClick={() => setOpen(true)}>
        <Copy className="h-4 w-4" aria-hidden /> Copy to my {training.kind === 'exercise' ? 'exercises' : 'plans'}
      </button>
      {open && <CopyTrainingSheet postId={postId} training={training} onClose={() => setOpen(false)} />}
    </>
  );
}
