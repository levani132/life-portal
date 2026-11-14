'use client';

import clsx from 'clsx';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { outbox, outboxItems, useOutbox } from '../lib/offline/runtime';
import type { OutboxItem } from '../lib/offline/types';
import { conflictOf, combinedText, diffFields, type Conflict } from '../lib/offline/conflicts';
import { canLogAgain, keepMine, keepTheirs, logAgain, saveCombined, type Undo } from '../lib/sync-conflicts';
import { refusedCommentText } from '../lib/social-offline';
// Spec 032: registers the "posted" note for drafts published while any page is open.
import '../lib/post-drafts';
import { finishOtherAndRetry, isSessionConflict, saveMovedWorkout } from '../lib/training-offline';
import { useWorkoutDay } from '../lib/training';
import { movedToToday, tooOldStart } from '../lib/offline/too-old';
import { Modal, Textarea } from './ui';

/**
 * The header's sync pill (spec 027, issue #16). It says only what is true: nothing at all while
 * no write is waiting, and never "saved" for a write the server has not acknowledged. Tapping it
 * opens the list of waiting writes, each retryable and discardable (with a confirmation).
 */
export function SyncStatus() {
  const snapshot = useOutbox();
  const [open, setOpen] = useState(false);
  // Spec 030: a weigh-in choice can be put back once, while the sheet is open.
  const [undo, setUndo] = useState<{ text: string; run: Undo } | null>(null);
  const items = snapshot.items;
  if (!items.length && !open) return null;

  const auth = items.some((item) => item.state === 'auth');
  const attention = items.filter(
    (item) => item.state === 'error' || item.state === 'conflict' || item.state === 'held',
  ).length;
  const label = auth
    ? 'Sign in to sync'
    : attention
      ? `${attention} need${attention === 1 ? 's' : ''} attention`
      : snapshot.syncing
        ? `Syncing ${items.length}`
        : snapshot.offline
          ? `Offline · ${items.length} waiting`
          : `${items.length} waiting`;
  const tone =
    auth || attention
      ? 'border-rose-500/50 text-rose-300'
      : 'border-amber-500/50 text-amber-300';

  return (
    <>
      {items.length > 0 && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={clsx(
            'rounded-full border px-2.5 py-1 text-[11px] font-medium',
            tone,
          )}
          aria-label={`Sync status: ${label}`}
        >
          {label}
        </button>
      )}
      {/* In a portal: the header's backdrop blur makes it the containing block for `fixed`,
          which would clip the sheet to the header's height. */}
      {open &&
        createPortal(
          <Modal
            open
            onClose={() => {
              setOpen(false);
              setUndo(null);
            }}
            title="Changes on this device"
          >
            {undo && (
              <div className="mb-2 flex items-center justify-between gap-2 rounded-md border border-border bg-surface p-2 text-xs">
                <span>{undo.text}</span>
                <button
                  type="button"
                  className="btn-ghost px-2 py-1 text-xs"
                  onClick={() => {
                    const { run } = undo;
                    setUndo(null);
                    void run();
                  }}
                >
                  Undo
                </button>
              </div>
            )}
            {items.length === 0 ? (
              <p className="text-sm text-ink-muted">
                Everything has reached the server.
              </p>
            ) : (
              <>
                <p className="text-sm text-ink-muted">
                  These changes are kept on this device until the server
                  confirms them.
                  {auth &&
                    ' Your session ended: sign in again with the same account to send them.'}
                </p>
                <ul className="space-y-2">
                  {items.map((item) => (
                    <SyncRow key={item.id} item={item} onUndo={setUndo} />
                  ))}
                </ul>
                <div className="flex justify-end">
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={snapshot.syncing}
                    onClick={() => void outbox.retryAll()}
                  >
                    {snapshot.syncing ? 'Sending…' : 'Sync now'}
                  </button>
                </div>
              </>
            )}
          </Modal>,
          document.body,
        )}
    </>
  );
}

const STATE_TEXT: Record<OutboxItem['state'], string> = {
  pending: 'Waiting to send',
  auth: 'Waiting for sign-in',
  error: 'Not accepted',
  conflict: 'Changed elsewhere',
  held: 'Waiting for you',
};

function SyncRow({ item, onUndo }: { item: OutboxItem; onUndo: (undo: { text: string; run: Undo } | null) => void }) {
  const [confirm, setConfirm] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const workoutConflict = isSessionConflict(item);
  const finishOther = async () => {
    setResolving(true);
    setProblem(null);
    try {
      await finishOtherAndRetry(item);
    } catch (caught) {
      setProblem(caught instanceof Error ? caught.message : 'Could not finish the other workout.');
    } finally {
      setResolving(false);
    }
  };
  const stuck = item.state === 'error' || item.state === 'conflict';
  const clash = conflictOf(item);
  const comment = refusedCommentText(item);
  const tooOld = tooOldStart(item);
  return (
    <li className="rounded-lg border border-border p-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium">{item.label ?? item.kind}</p>
          <p
            className={clsx(
              'text-xs',
              stuck ? 'text-rose-300' : 'text-ink-faint',
            )}
          >
            {STATE_TEXT[item.state]}
            {item.lastError && (stuck || item.attempts > 0)
              ? ` · ${item.lastError}`
              : ''}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          {/* Sending a clashing edit again would only clash again: the person chooses below. */}
          {!clash && !tooOld && item.state !== 'held' && (
            <button
              type="button"
              className="btn-ghost px-2 py-1 text-xs"
              onClick={() => void outbox.retry(item.id)}
            >
              Retry
            </button>
          )}
          <button
            type="button"
            className="btn-ghost px-2 py-1 text-xs text-rose-300"
            onClick={() => setConfirm(true)}
          >
            Discard
          </button>
        </div>
      </div>
      {/* Spec 028: two open workouts are never merged; the person picks which one stays open. */}
      {workoutConflict && (
        <div className="mt-2 space-y-2 rounded-md bg-amber-500/10 p-2 text-xs">
          <p>
            Another workout is open, probably on another device. Finish that one (at its last set) and send this one,
            or discard this one and keep the other.
          </p>
          <div className="flex justify-end">
            <button type="button" className="btn-primary px-2 py-1 text-xs" disabled={resolving} onClick={() => void finishOther()}>
              {resolving ? 'Finishing…' : 'Finish the other, send this'}
            </button>
          </div>
          {problem && <p className="text-rose-300">{problem}</p>}
        </div>
      )}
      {clash && <ClashChoice item={item} clash={clash} onUndo={onUndo} />}
      {tooOld && <TooOldChoice item={item} recordedAt={tooOld.recordedAt} />}
      {/* Spec 034: queued more than 30 days ago; sent only if the person still wants it. */}
      {item.state === 'held' && (
        <div className="mt-2 space-y-2 rounded-md bg-amber-500/10 p-2 text-xs">
          <p>
            Saved on this device on <strong>{when(new Date(item.createdAt).toISOString())}</strong>, more than 30 days
            ago, and not sent yet. Send it now, or discard it.
          </p>
          <div className="flex justify-end">
            <button type="button" className="btn-primary px-2 py-1 text-xs" onClick={() => void outbox.confirm(item.id)}>
              Send anyway
            </button>
          </div>
        </div>
      )}
      {/* Spec 031: a comment on a post that is gone keeps its text here, to copy before discarding. */}
      {comment && (
        <div className="mt-2 space-y-1 rounded-md bg-amber-500/10 p-2 text-xs">
          <p>{item.lastErrorCode === 'POST_GONE' ? 'This post is no longer available, so your comment was not posted.' : 'Your comment:'}</p>
          <p className="select-text whitespace-pre-wrap break-words rounded border border-border bg-surface p-2 text-sm">{comment}</p>
        </div>
      )}
      {confirm && (
        <div className="mt-2 flex flex-wrap items-center justify-end gap-2 rounded-md bg-rose-500/10 p-2 text-xs">
          <span className="mr-auto">
            Delete this change for good? Changes that depend on it go too.
          </span>
          <button
            type="button"
            className="btn-ghost px-2 py-1 text-xs"
            onClick={() => setConfirm(false)}
          >
            Keep
          </button>
          <button
            type="button"
            className="btn-danger px-2 py-1 text-xs"
            onClick={() => void outbox.discard(item.id)}
          >
            Discard
          </button>
        </div>
      )}
    </li>
  );
}

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/**
 * Spec 034: a workout recorded more than 14 days ago. The server keeps device times only within
 * 14 days and never moves one silently, so the person sees the time as recorded and the one it
 * would be saved with, and confirms. Its sets and finish move with it, keeping their spacing.
 */
function TooOldChoice({ item, recordedAt }: { item: OutboxItem; recordedAt: string }) {
  const workoutDay = useWorkoutDay();
  const [proposal, setProposal] = useState<ReturnType<typeof movedToToday>>();
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const propose = () => setProposal(movedToToday(outboxItems(), item, new Date().toISOString(), workoutDay()));
  const save = async () => {
    if (!proposal) return;
    setSaving(true);
    setProblem(null);
    try {
      await saveMovedWorkout(proposal.writes);
    } catch (caught) {
      setProblem(caught instanceof Error ? caught.message : 'Could not save the workout.');
      setSaving(false);
    }
  };
  return (
    <div className="mt-2 space-y-2 rounded-md bg-amber-500/10 p-2 text-xs">
      <p>
        This workout was recorded on <strong>{when(recordedAt)}</strong>, more than 14 days ago, so it can’t be saved
        with that date. You can save it with today’s date instead, or discard it.
      </p>
      {proposal ? (
        <div className="space-y-2 rounded border border-border bg-surface p-2">
          <p>Recorded: {when(recordedAt)}</p>
          <p>
            Will be saved as: <strong>{when(proposal.startedAt)}</strong>. Its sets keep their spacing, so it ends now.
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost px-2 py-1 text-xs" disabled={saving} onClick={() => setProposal(undefined)}>
              Cancel
            </button>
            <button type="button" className="btn-primary px-2 py-1 text-xs" disabled={saving} onClick={() => void save()}>
              {saving ? 'Saving…' : 'Save with today’s date'}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex justify-end">
          <button type="button" className="btn-primary px-2 py-1 text-xs" onClick={propose}>
            Save with today’s date…
          </button>
        </div>
      )}
      {problem && <p className="text-rose-300">{problem}</p>}
    </div>
  );
}

/**
 * Spec 030: an edit that clashed with another device. Nothing is merged on its own: numbers are
 * mine or theirs, a note can be combined through a preview the person edits and confirms, and a
 * row deleted elsewhere is either dropped or added again with this change.
 */
function ClashChoice({
  item,
  clash,
  onUndo,
}: {
  item: OutboxItem;
  clash: Conflict;
  onUndo: (undo: { text: string; run: Undo } | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [combining, setCombining] = useState<string | null>(null);
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setProblem(null);
    try {
      await fn();
    } catch (caught) {
      setProblem(caught instanceof Error ? caught.message : 'Could not do that.');
    } finally {
      setBusy(false);
    }
  };

  if (clash.type === 'deleted') {
    return (
      <div className="mt-2 space-y-2 rounded-md bg-amber-500/10 p-2 text-xs">
        <p>This was deleted on another device after you changed it here.</p>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="btn-ghost px-2 py-1 text-xs" disabled={busy} onClick={() => void act(() => outbox.discard(item.id))}>
            Discard my change
          </button>
          {canLogAgain(clash) && (
            <button type="button" className="btn-primary px-2 py-1 text-xs" disabled={busy} onClick={() => void act(() => logAgain(item))}>
              Add it again
            </button>
          )}
        </div>
        {problem && <p className="text-rose-300">{problem}</p>}
      </div>
    );
  }

  const diffs = diffFields(clash);
  const text = diffs.find((diff) => diff.text);
  const textField = clash.edit.textField;
  const mineText = textField ? clash.edit.patch[textField] : undefined;
  const theirsText = textField ? clash.theirs[textField] : undefined;
  const weighIn = clash.edit.kind === 'weighin';
  const decide = (keep: 'mine' | 'theirs') =>
    void act(async () => {
      const undo = keep === 'mine' ? await keepMine(item) : await keepTheirs(item);
      onUndo(undo ? { text: keep === 'mine' ? 'Kept your weigh-in.' : 'Kept the other weigh-in.', run: undo } : null);
    });

  return (
    <div className="mt-2 space-y-2 rounded-md bg-amber-500/10 p-2 text-xs">
      <p>{weighIn ? 'Another device recorded a weigh-in for this day too. Which one is right?' : 'This was changed on another device too. Which version should stay?'}</p>
      <table className="w-full table-fixed text-left">
        <thead className="text-ink-faint">
          <tr>
            <th className="w-1/4 font-normal" />
            <th className="font-normal">Yours (this device)</th>
            <th className="font-normal">Theirs (saved)</th>
          </tr>
        </thead>
        <tbody>
          {diffs.map((diff) => (
            <tr key={diff.field} className="align-top">
              <td className="text-ink-faint">{diff.label}</td>
              <td className="whitespace-pre-wrap break-words pr-2">{diff.mine}</td>
              <td className="whitespace-pre-wrap break-words">{diff.theirs}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {combining !== null ? (
        <div className="space-y-2">
          <p className="text-ink-muted">Both notes, combined. Edit it, then save: this replaces the saved note.</p>
          <Textarea rows={4} value={combining} onChange={(event) => setCombining(event.target.value)} />
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost px-2 py-1 text-xs" disabled={busy} onClick={() => setCombining(null)}>
              Back
            </button>
            <button
              type="button"
              className="btn-primary px-2 py-1 text-xs"
              disabled={busy || !combining.trim()}
              onClick={() => void act(() => saveCombined(item, combining.trim()))}
            >
              Save combined note
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap justify-end gap-2">
          {text && (
            <button
              type="button"
              className="btn-ghost px-2 py-1 text-xs"
              disabled={busy}
              onClick={() => setCombining(combinedText(theirsText, mineText))}
            >
              Combine notes…
            </button>
          )}
          <button type="button" className="btn-ghost px-2 py-1 text-xs" disabled={busy} onClick={() => decide('theirs')}>
            Keep theirs
          </button>
          <button type="button" className="btn-primary px-2 py-1 text-xs" disabled={busy} onClick={() => decide('mine')}>
            Keep mine
          </button>
        </div>
      )}
      {problem && <p className="text-rose-300">{problem}</p>}
    </div>
  );
}
