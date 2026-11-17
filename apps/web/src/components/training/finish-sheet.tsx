'use client';

import { useMemo, useState } from 'react';
import { Dumbbell, Layers, Repeat, Scale, Timer, Weight } from 'lucide-react';
import type { RecentWeighIns, SessionDetail } from '@life-portal/shared-types';
import { displayToGrams, formatDay, gramsToDisplay, workoutTotals } from '@life-portal/shared-domain';
import { ErrorNote, Input, Modal, Textarea } from '../ui';
import { useApi } from '../../lib/hooks';
import { formatDuration, formatWeight, useTrainingProfile, useWorkoutDay } from '../../lib/training';
import { trainingWrites } from '../../lib/training-offline';
import { weighInField, weighInWrite } from '../../lib/finish-weigh-in';

export const RECENT_WEIGH_INS_KEY = '/training/weigh-ins/recent';

/**
 * Issue #25: tapping Finish opens this sheet. Nothing is saved until "Confirm & finish workout":
 * the workout's numbers, one optional body weight for the whole workout (never per exercise), and
 * the workout's note. Every write is queued like any other (spec 028), so it works offline, and a
 * retried confirm cannot double anything (each write carries its own idempotency key).
 */
export function FinishSheet({
  session,
  elapsedSeconds,
  onClose,
  onFinished,
}: {
  session: SessionDetail;
  elapsedSeconds: number;
  onClose: () => void;
  onFinished: (session: SessionDetail) => void;
}) {
  const profile = useTrainingProfile();
  const workoutDay = useWorkoutDay();
  const day = useMemo(() => workoutDay(), [workoutDay]);
  const recent = useApi<RecentWeighIns>(RECENT_WEIGH_INS_KEY, { revalidateOnMount: true });
  const field = weighInField(recent.data?.weighIns, day);
  const unit = profile.weightUnit;
  const prefillText = field.prefill ? String(gramsToDisplay(field.prefill.weightGrams, unit)) : '';

  const [weight, setWeight] = useState<string | null>(null);
  const [save, setSave] = useState(false);
  const [notes, setNotes] = useState(session.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const weightText = weight ?? prefillText;
  // The prefilled text, untouched, is exactly the stored grams (no unit round trip).
  const enteredGrams =
    weightText === prefillText && field.prefill
      ? field.prefill.weightGrams
      : weightText.trim() && Number.isFinite(Number(weightText))
        ? displayToGrams(Number(weightText), unit)
        : undefined;
  const planned = weighInWrite(field, enteredGrams, save);

  const totals = workoutTotals({ ...session, durationSeconds: elapsedSeconds });
  const unlogged = session.exercises.reduce((sum, exercise) => sum + (exercise.skipped ? 0 : exercise.openTargets.length), 0);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      if (notes !== (session.notes ?? '')) await trainingWrites.patchSession(session, { notes });
      if (planned) await trainingWrites.weighIn(session.id, { day, weightGrams: planned.weightGrams }, field.today);
      await trainingWrites.finish(session, 'now');
      onFinished(session);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not finish the workout.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Finish workout">
      <div className="space-y-4">
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Stat icon={Timer} label="Time" value={formatDuration(totals.durationSeconds)} />
          <Stat icon={Weight} label="Volume" value={totals.volumeGrams ? formatWeight(totals.volumeGrams, unit) : '—'} />
          <Stat icon={Layers} label="Working sets" value={String(totals.workingSets)} />
          <Stat icon={Repeat} label="Reps" value={String(totals.reps)} />
          <Stat icon={Dumbbell} label="Exercises" value={String(totals.exercises)} />
        </dl>
        {unlogged > 0 && (
          <p className="text-xs text-ink-faint">
            {unlogged} planned {unlogged === 1 ? 'set is' : 'sets are'} not logged. Exercises with nothing logged are left out of
            the workout.
          </p>
        )}

        <section className="space-y-2 rounded-xl border border-border p-3" aria-labelledby="finish-weight">
          <div className="flex items-center gap-2">
            <Scale className="h-4 w-4 text-ink-faint" aria-hidden />
            <h4 id="finish-weight" className="text-sm font-semibold">
              Body weight <span className="font-normal text-ink-faint">· optional</span>
            </h4>
          </div>
          <p className="text-xs text-ink-faint">
            {field.today
              ? `Today's weigh-in: ${formatWeight(field.today.weightGrams, unit)}.`
              : field.prefill
                ? `Last weigh-in: ${formatWeight(field.prefill.weightGrams, unit)} on ${formatDay(field.prefill.day)}.`
                : 'No weigh-ins yet.'}{' '}
            Your own weight, not a lifting weight.
          </p>
          <div className="flex items-center gap-2">
            <Input
              inputMode="decimal"
              aria-label={`Body weight in ${unit}`}
              className="max-w-[8rem]"
              value={weightText}
              placeholder={unit}
              onChange={(event) => {
                setWeight(event.target.value);
                // Typing a number is asking to save it; the box can still be unticked.
                if (!field.today) setSave(true);
              }}
            />
            <span className="text-sm text-ink-faint">{unit}</span>
          </div>
          {field.today ? (
            planned?.replaces !== undefined && (
              <p className="text-xs font-medium text-warning" role="status">
                Replaces today's measurement of {formatWeight(planned.replaces, unit)}.
              </p>
            )
          ) : (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={save} onChange={(event) => setSave(event.target.checked)} />
              Save as today's weigh-in
            </label>
          )}
        </section>

        <Textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="How did it go? (optional)"
          rows={2}
          maxLength={2000}
          aria-label="Workout notes"
        />

        {error && <ErrorNote message={error} />}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn-ghost justify-center" onClick={onClose} disabled={busy}>
            Keep going
          </button>
          <button type="button" className="btn-primary justify-center" onClick={() => void confirm()} disabled={busy}>
            {busy ? 'Finishing…' : 'Confirm & finish workout'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Stat({ icon: Icon, label, value }: { icon: typeof Timer; label: string; value: string }) {
  return (
    <div className="rounded-xl bg-surface px-3 py-2">
      <dt className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-ink-faint">
        <Icon className="h-3.5 w-3.5" aria-hidden /> {label}
      </dt>
      <dd className="text-base font-bold tabular-nums">{value}</dd>
    </div>
  );
}
