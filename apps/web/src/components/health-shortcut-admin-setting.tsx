'use client';
import { useState } from 'react';
import { api } from '../lib/api';
import { revalidate, useAction, useApi } from '../lib/hooks';
import { ErrorNote, Field, Input, Panel } from './ui';

/** Rendered only for the developer; the API independently enforces the configured owner ID. */
export function HealthShortcutAdminSetting() {
  const settings = useApi<{ installationUrl: string }>(
    '/settings/health-shortcut',
  );
  const [saved, setSaved] = useState(false);
  return (
    <Panel
      title="Apple Health Shortcut"
      description="Admin only · Shared installation link for everyone."
    >
      {settings.error && (
        <ErrorNote message={(settings.error as Error).message} />
      )}
      {settings.isLoading ? (
        <p className="text-sm text-ink-muted">Loading Shortcut settings…</p>
      ) : (
        settings.data && (
          <ShortcutUrlForm
            key={settings.data.installationUrl}
            initialUrl={settings.data.installationUrl}
            onEdit={() => setSaved(false)}
            onSaved={async () => {
              await settings.mutate();
              await revalidate('/nutrition/health');
              setSaved(true);
            }}
          />
        )
      )}
      {saved && (
        <p role="status" className="mt-2 text-sm text-emerald-400">
          Shortcut link updated.
        </p>
      )}
    </Panel>
  );
}
function ShortcutUrlForm({
  initialUrl,
  onEdit,
  onSaved,
}: {
  initialUrl: string;
  onEdit: () => void;
  onSaved: () => Promise<void>;
}) {
  const [url, setUrl] = useState(initialUrl);
  const action = useAction();
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        void action.run(
          async () => {
            await api.put('/settings/health-shortcut', {
              installationUrl: url.trim(),
            });
            await onSaved();
          },
          { revalidate: false },
        );
      }}
    >
      <Field
        label="iCloud sharing URL"
        hint="Publish a fresh link for a new version to prompt users to update."
      >
        <Input
          type="url"
          required
          value={url}
          maxLength={200}
          placeholder="https://www.icloud.com/shortcuts/…"
          disabled={action.pending}
          onChange={(event) => {
            setUrl(event.target.value);
            onEdit();
          }}
        />
      </Field>
      {action.error && <ErrorNote message={action.error} />}
      <button
        type="submit"
        className="btn-primary"
        disabled={action.pending || url.trim() === initialUrl}
      >
        {action.pending ? 'Saving…' : 'Save Shortcut link'}
      </button>
    </form>
  );
}
