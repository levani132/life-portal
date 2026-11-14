'use client';

import clsx from 'clsx';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { outbox, useOutbox } from '../lib/offline/runtime';
import type { OutboxItem } from '../lib/offline/types';
import { Modal } from './ui';

/**
 * The header's sync pill (spec 027, issue #16). It says only what is true: nothing at all while
 * no write is waiting, and never "saved" for a write the server has not acknowledged. Tapping it
 * opens the list of waiting writes, each retryable and discardable (with a confirmation).
 */
export function SyncStatus() {
  const snapshot = useOutbox();
  const [open, setOpen] = useState(false);
  const items = snapshot.items;
  if (!items.length && !open) return null;

  const auth = items.some((item) => item.state === 'auth');
  const attention = items.filter(
    (item) => item.state === 'error' || item.state === 'conflict',
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
            onClose={() => setOpen(false)}
            title="Changes on this device"
          >
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
                    <SyncRow key={item.id} item={item} />
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
};

function SyncRow({ item }: { item: OutboxItem }) {
  const [confirm, setConfirm] = useState(false);
  const stuck = item.state === 'error' || item.state === 'conflict';
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
          <button
            type="button"
            className="btn-ghost px-2 py-1 text-xs"
            onClick={() => void outbox.retry(item.id)}
          >
            Retry
          </button>
          <button
            type="button"
            className="btn-ghost px-2 py-1 text-xs text-rose-300"
            onClick={() => setConfirm(true)}
          >
            Discard
          </button>
        </div>
      </div>
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
