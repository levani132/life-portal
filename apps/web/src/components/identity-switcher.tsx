'use client';

import type { Identity, MyPages, PageSummary } from '@life-portal/shared-types';
import { PAGE_BIO_MAX, PAGE_NAME_MAX } from '@life-portal/shared-types';
import { Check, Megaphone, Plus } from 'lucide-react';
import { useState } from 'react';
import { ApiError, api } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { useApi } from '../lib/hooks';
import { actingPageId, rememberActingPage, stopActing } from '../lib/identity';
import { deleteOfflineData, outbox } from '../lib/offline/runtime';
import { Avatar } from './avatar';
import { ErrorNote, Field, Input, Modal, Textarea } from './ui';

/** The small mark that says a name belongs to a page, not a person (spec 040). */
export function PageMark({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-0.5 rounded-full bg-special-solid/10 px-1.5 py-px align-middle text-[10px] font-semibold uppercase tracking-wide text-special ${className}`}
      title="This is a page, not a person"
    >
      <Megaphone size={10} aria-hidden="true" />
      Page
    </span>
  );
}

/** Who the app is being used as, for anything that needs to know. `null` while it is loading. */
export function useIdentity(): Identity | null {
  const acting = actingPageId();
  const { user } = useAuth();
  const identity = useApi<Identity>(user && acting ? '/identity' : null, { revalidateOnFocus: false });
  if (!user) return null;
  if (!acting) return { kind: 'person', id: user.id };
  return identity.data ?? null;
}

/**
 * Switches identity and starts the app again. Unsent changes belong to the identity that made
 * them, so a switch waits until they are sent; what the device kept for offline use is cleared,
 * because it would otherwise show one identity's data to the other.
 */
async function switchTo(pageId: string | null, userId: string): Promise<string | null> {
  if (outbox.count() > 0) return 'Some changes on this device have not been sent yet. Wait for them to sync, then switch.';
  await deleteOfflineData(userId).catch(() => undefined);
  if (pageId) {
    rememberActingPage(pageId);
    window.location.assign('/');
  } else stopActing();
  return null;
}

/** The list at the top of the menu: yourself, the pages you manage, and "Create a page". */
export function IdentitySwitcher() {
  const { user } = useAuth();
  const pages = useApi<MyPages>('/pages');
  const acting = actingPageId();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!user || !pages.data) return null;
  // Nothing to show for an account without the feature and without pages.
  if (!pages.data.pages.length && pages.data.remaining === 0) return null;

  const choose = (pageId: string | null) => {
    if (pageId === acting) return;
    setError(null);
    void switchTo(pageId, user.id).then(setError);
  };
  const canCreate = pages.data.remaining === null || pages.data.remaining > 0;

  return (
    <section className="card mb-4" aria-label="Who you are using the app as">
      <p className="px-5 pt-4 text-xs font-semibold uppercase tracking-wide text-ink-faint">Using the app as</p>
      <ul className="mt-2 divide-y divide-border">
        <Row name={user.name} note="You" active={!acting} onChoose={() => choose(null)} />
        {pages.data.pages.map((page) => (
          <Row
            key={page.id}
            name={page.name}
            note={page.suspended ? 'Suspended' : `@${page.username}`}
            avatarUrl={page.avatarUrl}
            page
            active={acting === page.id}
            disabled={page.suspended}
            onChoose={() => choose(page.id)}
          />
        ))}
      </ul>
      {error && (
        <div className="px-5 pb-3">
          <ErrorNote message={error} />
        </div>
      )}
      <div className="border-t border-border px-5 py-3">
        {canCreate ? (
          <button type="button" className="btn-ghost gap-2" onClick={() => setCreating(true)}>
            <Plus size={16} aria-hidden="true" />
            Create a page
          </button>
        ) : (
          <p className="text-xs text-ink-faint">You have created as many pages as your account allows. Write to support if you need more.</p>
        )}
      </div>
      {creating && (
        <CreatePage
          onClose={() => setCreating(false)}
          onCreated={(page) => {
            setCreating(false);
            choose(page.id);
          }}
        />
      )}
    </section>
  );
}

function Row({
  name,
  note,
  avatarUrl,
  page,
  active,
  disabled,
  onChoose,
}: {
  name: string;
  note: string;
  avatarUrl?: string;
  page?: boolean;
  active: boolean;
  disabled?: boolean;
  onChoose: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-surface-raised disabled:opacity-50"
        aria-pressed={active}
        disabled={disabled}
        onClick={onChoose}
      >
        <Avatar name={name} url={avatarUrl} size={36} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate font-medium">{name}</span>
            {page && <PageMark />}
          </span>
          <span className="block truncate text-xs text-ink-faint">{note}</span>
        </span>
        {active && <Check size={18} className="shrink-0 text-accent" aria-label="In use" />}
      </button>
    </li>
  );
}

const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);

function CreatePage({ onClose, onCreated }: { onClose: () => void; onCreated: (page: PageSummary) => void }) {
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [touched, setTouched] = useState(false);
  const [bio, setBio] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      onCreated(await api.post<PageSummary>('/pages', { name, username: username || slug(name), bio }));
    } catch (caught) {
      setError(caught instanceof ApiError ? (caught.details?.[0] ?? caught.message) : 'That did not work. Check your connection and try again.');
      setPending(false);
    }
  }

  return (
    <Modal open onClose={() => !pending && onClose()} title="Create a page" onSubmit={submit} submitLabel={pending ? 'Creating…' : 'Create page'} pending={pending} error={error}>
      <div className="space-y-4">
        <p className="text-sm text-ink-muted">
          A page publishes content and nothing else: it has no diary, workouts or weight. It is always shown as a page, never as a person.
        </p>
        <Field label="Name">
          <Input
            required
            maxLength={PAGE_NAME_MAX}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              if (!touched) setUsername(slug(event.target.value));
            }}
          />
        </Field>
        <Field label="Username" hint="3 to 30 lowercase letters, numbers, hyphens or underscores. Shared with people’s usernames.">
          <Input
            required
            autoCapitalize="none"
            autoCorrect="off"
            value={username}
            onChange={(event) => {
              setTouched(true);
              setUsername(event.target.value.toLowerCase());
            }}
          />
        </Field>
        <Field label="What it is about (optional)">
          <Textarea rows={3} maxLength={PAGE_BIO_MAX} value={bio} onChange={(event) => setBio(event.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

/** The bar under the header while acting as a page: which page, and the way back. */
export function ActingBar() {
  const identity = useIdentity();
  const { user } = useAuth();
  const [error, setError] = useState<string | null>(null);
  if (!user || !actingPageId()) return null;
  const name = identity?.kind === 'page' ? identity.page.name : 'a page';
  return (
    <div role="status" className="flex items-center justify-center gap-2 bg-special-solid/10 px-3 py-1.5 text-xs text-special">
      <Megaphone size={12} aria-hidden="true" />
      <span className="min-w-0 truncate">
        {error ?? (
          <>
            Using the app as <strong className="font-semibold">{name}</strong>
          </>
        )}
      </span>
      <button type="button" className="shrink-0 font-semibold underline" onClick={() => void switchTo(null, user.id).then(setError)}>
        Switch back
      </button>
    </div>
  );
}
