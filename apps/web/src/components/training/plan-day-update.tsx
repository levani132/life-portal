'use client';

import clsx from 'clsx';
import { ArrowRightLeft, Check, ClipboardList, Clock, Link2, MoveVertical, Plus, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { mutate } from 'swr';
import type { PlanDayChange, PlanDayLine, PlanDayUpdatePreview, PlanDayUpdateResult } from '@life-portal/shared-types';
import { describeTarget, formatDuration } from '@life-portal/shared-domain';
import { api, ApiError, NetworkError } from '../../lib/api';
import { outbox } from '../../lib/offline/runtime';
import { trainingWrites, usePlanUpdateItem } from '../../lib/training-offline';
import { useApi } from '../../lib/hooks';
import { PLANS_KEY, planKey, useWeightUnit } from '../../lib/training';
import { Modal } from '../ui';
import { summariseTargets } from './plans';

export const planUpdateKey = (sessionId: string) => `/training/sessions/${sessionId}/plan-update`;

const DISMISSED = 'lp.planUpdate.dismissed';

/** "Not now" is remembered on this device only; it changes nothing and can be undone by a refresh of storage. */
function readDismissed(): string[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(DISMISSED) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function writeDismissed(ids: string[]) {
  try {
    window.localStorage.setItem(DISMISSED, JSON.stringify(ids.slice(-50)));
  } catch {
    // Private mode or blocked storage: "Not now" just lasts until the page is left.
  }
}

const COUNT_LABELS: Record<PlanDayChange['kind'], [string, string]> = {
  added: ['added', 'added'],
  removed: ['removed', 'removed'],
  replaced: ['swapped', 'swapped'],
  moved: ['moved', 'moved'],
  rest: ['rest change', 'rest changes'],
  superset: ['superset change', 'superset changes'],
};

/** `1 added · 2 moved`: a line short enough for the card. */
function countLine(changes: PlanDayChange[]): string {
  const counts = new Map<PlanDayChange['kind'], number>();
  for (const change of changes) counts.set(change.kind, (counts.get(change.kind) ?? 0) + 1);
  return [...counts]
    .map(([kind, count]) => `${count} ${COUNT_LABELS[kind][count === 1 ? 0 : 1]}`)
    .join(' · ');
}

const restText = (seconds?: number) => (seconds == null ? 'default' : formatDuration(seconds));

function ChangeRow({ change }: { change: PlanDayChange }) {
  let icon: ReactNode;
  let text: ReactNode;
  switch (change.kind) {
    case 'added':
      icon = <Plus className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />;
      text = (
        <>
          Add <b>{change.name}</b>, {change.sets} planned {change.sets === 1 ? 'set' : 'sets'}
        </>
      );
      break;
    case 'removed':
      icon = <X className="h-4 w-4 text-rose-600 dark:text-rose-400" />;
      text = (
        <>
          Remove <b>{change.name}</b>
        </>
      );
      break;
    case 'replaced':
      icon = <ArrowRightLeft className="h-4 w-4 text-sky-600 dark:text-sky-400" />;
      text = (
        <>
          Replace <b>{change.fromName}</b> with <b>{change.toName}</b>
          <span className="block text-xs text-ink-faint">
            {change.targetsKept ? 'Keeps the planned sets.' : 'Planned sets from the sets you logged, without weights.'}
          </span>
        </>
      );
      break;
    case 'moved':
      icon = <MoveVertical className="h-4 w-4 text-ink-muted" />;
      text = (
        <>
          Move <b>{change.name}</b> to position {change.to}
        </>
      );
      break;
    case 'rest':
      icon = <Clock className="h-4 w-4 text-ink-muted" />;
      text = (
        <>
          Rest after <b>{change.name}</b>: {restText(change.from)} → {restText(change.to)}
        </>
      );
      break;
    case 'superset':
      icon = <Link2 className="h-4 w-4 text-ink-muted" />;
      text = change.to ? (
        <>
          Put <b>{change.name}</b> in a superset
        </>
      ) : (
        <>
          Take <b>{change.name}</b> out of its superset
        </>
      );
      break;
  }
  return (
    <li className="flex items-start gap-2 py-1.5 text-sm">
      <span className="mt-0.5 shrink-0" aria-hidden>
        {icon}
      </span>
      <span className="min-w-0">{text}</span>
    </li>
  );
}

const LINE_BADGE: Record<NonNullable<PlanDayLine['change']>, string> = {
  added: 'New',
  replaced: 'Swapped',
  moved: 'Moved',
  changed: 'Changed',
};

function DayLines({ lines }: { lines: PlanDayLine[] }) {
  const unit = useWeightUnit();
  if (!lines.length) return <p className="text-xs text-ink-faint">No exercises.</p>;
  return (
    <ol className="divide-y divide-border">
      {lines.map((line, index) => (
        <li key={index} className="flex items-start gap-2 py-1.5">
          <span className="w-5 shrink-0 text-right text-xs tabular-nums text-ink-faint">{index + 1}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{line.name}</p>
            <p className="text-xs text-ink-faint">
              {summariseTargets(line.targets.map((target) => describeTarget(line.measure, target, unit)))}
              {line.restSeconds != null && ` · rest ${formatDuration(line.restSeconds)}`}
              {line.superset && ' · superset'}
            </p>
          </div>
          {line.change && (
            <span
              className={clsx(
                'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold',
                line.change === 'added' ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-accent/15 text-ink',
              )}
            >
              {LINE_BADGE[line.change]}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

/**
 * Issue #15: after a plan workout, offer to update that plan day with what was done differently.
 * Shown on a finished workout (right after Finish, and in History), never on an ad-hoc one. It
 * never blocks anything: "Not now" or closing the review leaves the plan as it is.
 */
export function PlanDayUpdate({ sessionId }: { sessionId: string }) {
  const { data, mutate: refresh } = useApi<PlanDayUpdatePreview>(planUpdateKey(sessionId));
  const [dismissed, setDismissed] = useState(() => readDismissed().includes(sessionId));
  const [open, setOpen] = useState(false);
  const queued = usePlanUpdateItem(sessionId);

  // Spec 028: reviewed with no connection; sent with the revision it was reviewed against.
  if (queued) {
    const refused = queued.state === 'error' || queued.state === 'conflict';
    return (
      <div className="flex flex-wrap items-center gap-2 px-1 text-xs">
        <p className={clsx('min-w-0 flex-1', refused ? 'text-rose-600 dark:text-rose-300' : 'text-ink-muted')}>
          {refused
            ? `The plan update was not saved: ${queued.lastError ?? 'it was refused.'}`
            : 'The plan update is kept on this device and is sent when there is a connection.'}
        </p>
        {refused && (
          <button
            type="button"
            className="btn-ghost px-2 py-1 text-xs"
            onClick={() =>
              // Re-review: drop the refused update and show the day as it is now.
              void outbox.discard(queued.id).then(() => refresh()).then(() => setOpen(true))
            }
          >
            Review again
          </button>
        )}
      </div>
    );
  }
  if (!data) return null;
  if (data.status === 'applied' && data.applied) {
    return (
      <p className="flex items-center gap-1.5 px-1 text-xs text-ink-muted">
        <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden />
        {data.applied.copied
          ? `Saved ${data.workoutName} to your copy of ${data.planName}.`
          : `${data.workoutName} in ${data.planName} was updated from this workout.`}
      </p>
    );
  }
  if (data.status === 'invalid') {
    return (
      <p className="px-1 text-xs text-ink-faint">
        This workout’s changes can’t be saved to {data.workoutName}: {data.message}
      </p>
    );
  }
  if (data.status !== 'available' || dismissed) return null;

  const dismiss = () => {
    writeDismissed([...readDismissed(), sessionId]);
    setDismissed(true);
  };

  return (
    <>
      <section className="card flex flex-wrap items-center gap-3 p-4" aria-label="Update plan day">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-ink" aria-hidden>
          <ClipboardList className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            {data.shared ? `Save ${data.workoutName} as you did it?` : `Update ${data.workoutName} in ${data.planName}?`}
          </p>
          <p className="truncate text-xs text-ink-faint">{countLine(data.changes)}</p>
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          <button type="button" className="btn-ghost flex-1 justify-center sm:flex-none" onClick={dismiss}>
            Not now
          </button>
          <button type="button" className="btn-primary flex-1 justify-center sm:flex-none" onClick={() => setOpen(true)}>
            Review
          </button>
        </div>
      </section>
      {open && (
        <PlanDayReview
          sessionId={sessionId}
          preview={data}
          onClose={() => setOpen(false)}
          onChanged={() => void refresh()}
        />
      )}
    </>
  );
}

function PlanDayReview({
  sessionId,
  preview,
  onClose,
  onChanged,
}: {
  sessionId: string;
  preview: PlanDayUpdatePreview;
  onClose: () => void;
  onChanged: () => void;
}) {
  // One id per review, so a retried tap never applies twice.
  const [requestId] = useState(() => crypto.randomUUID());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = async () => {
    setPending(true);
    setError(null);
    try {
      const result = await api.post<PlanDayUpdateResult>(planUpdateKey(sessionId), { requestId, revision: preview.revision ?? 0 });
      await Promise.all([
        mutate(planUpdateKey(sessionId)),
        mutate(PLANS_KEY),
        mutate(planKey(result.planId)),
        preview.planId ? mutate(planKey(preview.planId)) : undefined,
      ]);
      onClose();
    } catch (caught) {
      if (caught instanceof NetworkError) {
        // No connection: keep it, with the revision reviewed, and send it later (spec 028).
        await trainingWrites.planUpdate(sessionId, requestId, preview.revision ?? 0, preview.workoutName);
        onClose();
        return;
      }
      if (caught instanceof ApiError && caught.status === 409) {
        // The day moved on (or the workout already updated it): show what is true now.
        onChanged();
        setError(`${caught.message} The changes below may have changed.`);
      } else {
        setError(caught instanceof ApiError ? caught.message : 'Could not reach the server. Try again.');
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Update ${preview.workoutName ?? 'plan day'}`}
      wide
      onSubmit={() => void apply()}
      submitLabel={preview.shared ? 'Save as my copy' : `Update ${preview.workoutName ?? 'day'}`}
      pending={pending}
      error={error}
    >
      {preview.shared && (
        <p className="rounded-xl border border-border bg-accent/10 px-3 py-2 text-xs text-ink-muted">
          {preview.planName} is a ready-made plan. Saving makes your own copy of it with {preview.workoutName} updated; the
          ready-made plan stays as it is.
        </p>
      )}
      {preview.editedSince && (
        <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
          {preview.workoutName} was edited after this workout started. The changes are shown against how it is now, and
          anything this workout did not touch stays as it is.
        </p>
      )}
      <section aria-label="Changes">
        <h4 className="label">What changes</h4>
        <ul className="divide-y divide-border">
          {preview.changes.map((change, index) => (
            <ChangeRow key={index} change={change} />
          ))}
        </ul>
      </section>
      <section aria-label={`${preview.workoutName} after`}>
        <h4 className="label">{preview.workoutName} after</h4>
        <DayLines lines={preview.after} />
      </section>
      <details className="rounded-xl border border-border px-3 py-2">
        <summary className="cursor-pointer text-xs font-semibold text-ink-muted">{preview.workoutName} now</summary>
        <div className="mt-1">
          <DayLines lines={preview.before} />
        </div>
      </details>
      <p className="text-xs text-ink-faint">
        Only this day changes. Planned sets never take this workout’s weights, and the workout itself, your records and ranks
        stay as they are.
      </p>
    </Modal>
  );
}
