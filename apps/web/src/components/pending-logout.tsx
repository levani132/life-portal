'use client';

import { useEffect, useRef, useState } from 'react';
import { outbox, useOutbox } from '../lib/offline/runtime';
import { Modal } from './ui';

/**
 * Asked before anything would delete writes that are still on this device (spec 027, issue #16):
 * signing out, or clearing offline data. Shows how many are waiting and offers to send them,
 * to stay, or — behind a second, explicit confirmation — to give them up. Never silent.
 *
 * With nothing left waiting (for example after "Sync now" succeeded) it proceeds on its own.
 */
export function PendingLogout({
  onCancel,
  onSignOut,
  title = 'Unsent changes on this device',
  proceedLabel = 'Discard pending changes and log out',
  stayLabel = 'Stay signed in',
}: {
  onCancel: () => void;
  onSignOut: () => void;
  title?: string;
  proceedLabel?: string;
  stayLabel?: string;
}) {
  const snapshot = useOutbox();
  const waiting = snapshot.items.length;
  const [confirming, setConfirming] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const syncNow = async () => {
    setSyncing(true);
    setError(null);
    try {
      await outbox.retryAll();
    } finally {
      setSyncing(false);
    }
    if (outbox.count() > 0) setError('Some changes could not be sent yet. They are still on this device.');
  };

  // Everything went: nothing is lost by continuing. Once only.
  const proceeded = useRef(false);
  useEffect(() => {
    if (waiting === 0 && !syncing && !proceeded.current) {
      proceeded.current = true;
      onSignOut();
    }
  }, [waiting, syncing, onSignOut]);

  return (
    <Modal open onClose={onCancel} title={title} error={error}>
      <p className="text-sm text-ink-muted">
        {waiting === 1 ? '1 change has' : `${waiting} changes have`} not reached the server yet. They exist only on
        this device.
      </p>
      {confirming ? (
        <div className="space-y-3 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3">
          <p className="text-sm">
            Discarding deletes {waiting === 1 ? 'this change' : `these ${waiting} changes`} for good. This cannot be
            undone.
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => setConfirming(false)}>
              Keep them
            </button>
            <button type="button" className="btn-danger" onClick={onSignOut}>
              Yes, discard {waiting === 1 ? 'it' : `all ${waiting}`}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <button type="button" className="btn-primary" disabled={syncing} onClick={() => void syncNow()}>
            {syncing ? 'Sending…' : 'Sync now'}
          </button>
          <button type="button" className="btn-ghost" onClick={onCancel}>
            {stayLabel}
          </button>
          <button type="button" className="btn-danger" onClick={() => setConfirming(true)}>
            {proceedLabel}
          </button>
        </div>
      )}
    </Modal>
  );
}
