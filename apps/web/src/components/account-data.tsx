'use client';

import type { AccountExport, SignInMethods } from '@life-portal/shared-types';
import { useState } from 'react';
import useSWR from 'swr';
import { ApiError, api } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { APP_NAME } from '../lib/brand';
import { shareImageFile } from '../lib/share-image';
import { ErrorNote, Field, Input, Modal, Panel, PasswordInput } from './ui';

const problem = (caught: unknown) =>
  caught instanceof ApiError ? caught.message : 'That did not work. Check your connection and try again.';

/**
 * Download everything the account holds as one file (spec 038). Two taps on purpose: the phone
 * only lets a page hand over a file straight after a tap, and fetching takes longer than that.
 */
export function ExportPanel() {
  const [file, setFile] = useState<File | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function prepare() {
    setPending(true);
    setError(null);
    try {
      const data = await api.get<AccountExport>('/account/export');
      const records = Object.values(data.data).reduce((sum, rows) => sum + rows.length, 0);
      const name = `lifeportal-data-${data.exportedAt.slice(0, 10)}.json`;
      setFile(new File([JSON.stringify(data, null, 2)], name, { type: 'application/json' }));
      setSummary(`${records.toLocaleString()} records and ${data.files.length.toLocaleString()} photos or videos.`);
    } catch (caught) {
      setError(problem(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <Panel title="Download your data" description={`Everything ${APP_NAME} holds about you, in one file.`}>
      <div className="space-y-3 text-sm">
        <p className="text-ink-muted">
          The file holds your records as they are stored: food, training, posts, messages you sent, settings and the
          rest. Your photos and videos are in it as links that work for about an hour. Passwords and sign-in sessions
          are left out.
        </p>
        <p className="text-xs text-ink-faint">
          It is a JSON file: any text editor opens it, and other software can read it.
        </p>
        {error && <ErrorNote message={error} />}
        {file ? (
          <div className="space-y-2">
            <p role="status" className="text-ink">Ready: {summary}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-primary" onClick={() => void shareImageFile(file, file.name)}>
                Save the file
              </button>
              <button type="button" className="btn-ghost" onClick={() => { setFile(null); setSummary(null); }}>
                Discard
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn-primary" disabled={pending} onClick={() => void prepare()}>
            {pending ? 'Collecting…' : 'Prepare my data'}
          </button>
        )}
      </div>
    </Panel>
  );
}

/** Delete the account and everything in it (spec 038). */
export function DeleteAccountPanel() {
  const { user, forget } = useAuth();
  const methods = useSWR<SignInMethods>('/auth/methods', (path: string) => api.get<SignInMethods>(path), { revalidateOnFocus: false });
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmEmail, setConfirmEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasPassword = methods.data?.password ?? true;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api.post('/account/delete', hasPassword ? { password } : { confirmEmail });
      await forget();
    } catch (caught) {
      setError(problem(caught));
      setPending(false);
    }
  }

  return (
    <Panel title="Delete your account" description="For good. This cannot be undone.">
      <div className="space-y-3 text-sm">
        <ul className="list-disc space-y-1 pl-5 text-ink-muted">
          <li>Everything you logged, your posts, photos, comments, likes and messages are deleted.</li>
          <li>Conversations you were in disappear for the other person too.</li>
          <li>What other people already saved from your posts stays with them, without your name.</li>
          <li>Your email address becomes free to register again, as a new, empty account.</li>
        </ul>
        <p className="text-xs text-ink-faint">Download your data first if you want a copy: there is no way back.</p>
        <button type="button" className="btn-danger" onClick={() => setOpen(true)}>
          Delete my account
        </button>
      </div>
      <Modal
        open={open}
        onClose={() => { if (!pending) setOpen(false); }}
        title="Delete your account?"
        onSubmit={submit}
        submitLabel={pending ? 'Deleting…' : 'Delete everything'}
        pending={pending}
        error={error}
      >
        <div className="space-y-4 text-sm">
          <p className="text-ink-muted">
            This deletes {user?.email ?? 'your account'} and everything in it, on every device, straight away.
          </p>
          {hasPassword ? (
            <Field label="Your password">
              <PasswordInput autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
          ) : (
            <Field label="Type your email address to confirm">
              <Input type="email" autoComplete="off" required value={confirmEmail} onChange={(e) => setConfirmEmail(e.target.value)} />
            </Field>
          )}
        </div>
      </Modal>
    </Panel>
  );
}
