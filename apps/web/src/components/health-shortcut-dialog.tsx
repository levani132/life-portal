'use client';
import { useEffect, useId, useRef } from 'react';
import type { HealthShortcutPromptKind } from '../lib/health-shortcut-install';

export function HealthShortcutDialog({
  kind,
  onInstall,
  onConfirm,
  onLater,
  onDecline,
}: {
  kind: HealthShortcutPromptKind;
  onInstall: () => void;
  onConfirm: () => void;
  onLater: () => void;
  onDecline: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => {
      node?.close();
    };
  }, []);
  const confirming = kind === 'confirm';
  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault();
        if (confirming) onLater();
        else onDecline();
      }}
      className="fixed inset-0 z-[90] m-auto w-[calc(100%_-_2rem)] max-w-sm rounded-2xl border border-border bg-surface p-5 text-ink shadow-xl backdrop:bg-black/60"
    >
      <h2 id={titleId} className="text-lg font-semibold">
        {confirming
          ? 'Ready to sync?'
          : kind === 'update'
            ? 'New Health Shortcut available'
            : 'Install the Health Shortcut'}
      </h2>
      <div id={descriptionId} className="mt-3 space-y-2 text-sm text-ink-muted">
        {confirming ? (
          <>
            <p>
              Finish adding the Shortcut in Shortcuts, then confirm below. Keep
              its name “Life Portal Health”.
            </p>
            <p>
              If Shortcuts offers to replace the existing copy, choose Replace.
              If it creates a duplicate, rename the older copy, then name the
              new copy “Life Portal Health”.
            </p>
          </>
        ) : kind === 'update' ? (
          <p>
            There’s a new version of the Health Shortcut. Do you want to install
            it?
          </p>
        ) : (
          <>
            <p>
              Steps and calorie syncing needs the Life Portal Health Shortcut on
              this iPhone. Do you want to install it?
            </p>
            <p>We haven’t confirmed an installation on this device yet.</p>
          </>
        )}
        <p>
          Automatic syncing is optional. After installing, open the Shortcut in
          Shortcuts and enable its scheduled runs; installation alone does not
          enable them. You can always tap Sync in Life Portal manually.
        </p>
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-primary"
          onClick={confirming ? onConfirm : onInstall}
        >
          {confirming ? 'I installed it — sync' : 'Yes'}
        </button>
        {kind === 'update' && (
          <button type="button" className="btn" onClick={onLater}>
            Ask me later
          </button>
        )}
        <button
          type="button"
          className="btn"
          onClick={confirming ? onLater : onDecline}
        >
          {confirming ? 'Not yet' : 'No'}
        </button>
      </div>
      {confirming && (
        <button
          type="button"
          className="mt-3 text-sm text-accent underline"
          onClick={onInstall}
        >
          Open installation link again
        </button>
      )}
      {kind === 'install' && (
        <button
          type="button"
          className="mt-3 text-sm text-accent underline"
          onClick={onConfirm}
        >
          Already installed this version — sync
        </button>
      )}
    </dialog>
  );
}
