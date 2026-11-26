'use client';

import type { Identity, MyPages, PageSummary } from '@life-portal/shared-types';
import { PAGE_BIO_MAX, PAGE_NAME_MAX } from '@life-portal/shared-types';
import { Check, ChevronDown, Megaphone, Plus } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ApiError, api } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { revalidate, useApi } from '../lib/hooks';
import { actingPageId, lastActingPageId, rememberActingPage, stopActing } from '../lib/identity';
import { deleteOfflineData, outbox } from '../lib/offline/runtime';
import { Avatar } from './avatar';
import { ErrorNote, Field, Input, Modal, Textarea } from './ui';

/** The small mark that says a name belongs to a page, not a person (spec 040). */
export function PageMark({ className = '', ai = false }: { className?: string; ai?: boolean }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-0.5 rounded-full bg-special-solid/10 px-1.5 py-px align-middle text-[10px] font-semibold uppercase tracking-wide text-special ${className}`}
      title={ai ? 'This is a page, not a person. It is run with AI.' : 'This is a page, not a person'}
    >
      <Megaphone size={10} aria-hidden="true" />
      {ai ? 'Page · AI' : 'Page'}
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

const OPEN_KEY = 'lp.menu.identityOpen';

/** The list at the top of the menu: yourself, the pages you manage, and "Create a page". */
export function IdentitySwitcher({ inSheet = false }: { inSheet?: boolean } = {}) {
  const { user } = useAuth();
  const pages = useApi<MyPages>('/pages');
  const acting = actingPageId();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // In Menu the list folds into one row (who you are now), so the rest of the menu shows first.
  // Remembered on this device only; the sheet from the tab bar is always open.
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      setOpen(localStorage.getItem(OPEN_KEY) === '1');
    } catch {
      // No storage: start folded.
    }
  }, []);
  const toggle = () =>
    setOpen((now) => {
      try {
        localStorage.setItem(OPEN_KEY, now ? '0' : '1');
      } catch {
        // Not remembered; it still opens.
      }
      return !now;
    });
  if (!user || !pages.data) return null;
  // Nothing to show for an account without the feature and without pages.
  if (!pages.data.pages.length && pages.data.remaining === 0) return null;

  const choose = (pageId: string | null) => {
    if (pageId === acting) return;
    setError(null);
    void switchTo(pageId, user.id).then(setError);
  };
  const canCreate = pages.data.remaining === null || pages.data.remaining > 0;
  const current = pages.data.pages.find((page) => page.id === acting);
  const expanded = inSheet || open;

  return (
    <section className={inSheet ? '-mx-5' : 'card mb-4'} aria-label="Who you are using the app as">
      {/* In the sheet opened from the tab bar, the sheet's own title says it. */}
      {!inSheet && (
        <button type="button" aria-expanded={open} onClick={toggle} className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-surface-raised">
          <Avatar name={current?.name ?? user.name} url={current ? current.avatarUrl : pages.data.personAvatarUrl} size={36} />
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-semibold uppercase tracking-wide text-ink-faint">Using the app as</span>
            <span className="flex items-center gap-1.5">
              <span className="truncate font-medium">{current?.name ?? user.name}</span>
              {current && <PageMark />}
            </span>
          </span>
          {pages.data.pages.length > 0 && !open && <span className="shrink-0 text-xs text-ink-faint">{pages.data.pages.length} {pages.data.pages.length === 1 ? 'page' : 'pages'}</span>}
          <ChevronDown size={18} aria-hidden="true" className={`shrink-0 text-ink-faint transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      )}
      {expanded && (
      <>
      <ul className={`${inSheet ? 'mt-2' : 'border-t border-border'} divide-y divide-border`}>
        <Row name={user.name} note="You" avatarUrl={pages.data.personAvatarUrl} active={!acting} onChoose={() => choose(null)} />
        {pages.data.pages.map((page) => (
          <Row
            key={page.id}
            name={page.name}
            note={page.suspended ? 'Suspended' : page.disabled ? 'Switched off' : `@${page.username}`}
            avatarUrl={page.avatarUrl}
            page
            active={acting === page.id}
            disabled={page.suspended || page.disabled}
            onChoose={() => choose(page.id)}
          />
        ))}
      </ul>
      {error && (
        <div className="px-5 pb-3">
          <ErrorNote message={error} />
        </div>
      )}
      {pages.data.pages.length > 0 && (
        <Link href="/settings/pages" className="block border-t border-border px-5 py-3 text-sm text-ink-muted hover:bg-surface-raised">
          All pages at a glance
        </Link>
      )}
      {pages.data.pages.length > 0 && <ManagePages pages={pages.data.pages} userId={user.id} />}
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
      </>
      )}
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

/**
 * Spec 041: switch a page off or on, or delete it. Off, nobody finds the page or its posts and
 * nobody can use the app as it; nothing is deleted. Deleting removes everything, at once.
 */
function ManagePages({ pages, userId }: { pages: PageSummary[]; userId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (work: () => Promise<unknown>, pageId: string) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      // The page in use was switched off or deleted: go back to the person.
      if (actingPageId() === pageId) {
        await switchTo(null, userId);
        return;
      }
      await revalidate('/pages');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'That did not work. Try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="border-t border-border px-5 py-3 text-sm">
      <summary className="cursor-pointer text-ink-muted">Manage pages</summary>
      <ul className="mt-2 space-y-2">
        {pages.map((page) => (
          <li key={page.id} className="flex flex-wrap items-center justify-between gap-2">
            <span className="min-w-0 truncate">
              {page.name}
              {page.disabled && <span className="ml-2 text-xs text-ink-faint">switched off</span>}
            </span>
            <span className="flex gap-2">
              <button
                type="button"
                className="btn-ghost"
                disabled={busy}
                onClick={() => {
                  if (page.disabled || window.confirm(`Switch ${page.name} off? Nobody will find it or its posts until you switch it on again. Nothing is deleted.`))
                    void run(() => api.put(`/pages/${page.id}/disabled`, { disabled: !page.disabled }), page.disabled ? '' : page.id);
                }}
              >
                {page.disabled ? 'Switch on' : 'Switch off'}
              </button>
              <button
                type="button"
                className="btn-danger"
                disabled={busy}
                onClick={() => {
                  if (window.prompt(`Delete ${page.name} and everything it posted? This cannot be undone. Type the page’s username (${page.username}) to confirm.`) === page.username)
                    void run(() => api.delete(`/pages/${page.id}`), page.id);
                }}
              >
                Delete
              </button>
            </span>
          </li>
        ))}
      </ul>
      {error && <p className="mt-2 text-xs text-danger" role="alert">{error}</p>}
    </details>
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
/**
 * A link that says which identity it is for (`?as=<pageId>`, or `?as=me`): a page's notification
 * opens the app as that page. The switch follows the same rules as the menu's: nothing unsent
 * is left behind, and the app starts again. With unsent changes the link opens as you are.
 */
function useActAsLink(userId: string | undefined) {
  const pathname = usePathname();
  useEffect(() => {
    if (!userId) return;
    const url = new URL(window.location.href);
    const as = url.searchParams.get('as');
    if (!as) return;
    const target = as === 'me' ? null : /^[0-9a-f]{24}$/.test(as) ? as : undefined;
    url.searchParams.delete('as');
    const clean = url.pathname + url.search + url.hash;
    if (target === undefined || target === actingPageId() || outbox.count() > 0) {
      window.history.replaceState(window.history.state, '', clean);
      return;
    }
    void deleteOfflineData(userId)
      .catch(() => undefined)
      .then(() => {
        rememberActingPage(target);
        window.location.replace(clean);
      });
  }, [pathname, userId]);
}

/**
 * Mounted once by the shell. It shows nothing: which identity is in use is the photo on the
 * profile tab. It keeps the `?as=` links working.
 */
export function ActAsLinks() {
  const { user } = useAuth();
  useActAsLink(user?.id);
  return null;
}

/**
 * The other identity, for a double tap on the profile tab: from a page back to yourself; from
 * yourself to the page used last on this device (or your first usable page). Follows the menu's
 * rules: nothing unsent is left behind, and the app starts again. Answers a sentence when it
 * cannot switch, and `null` when it did or when there is nowhere to switch to.
 */
export async function switchToOtherIdentity(userId: string): Promise<string | null> {
  if (actingPageId()) return switchTo(null, userId);
  const mine = await api.get<MyPages>('/pages').catch(() => null);
  const usable = (mine?.pages ?? []).filter((page) => !page.suspended && !page.disabled);
  const last = lastActingPageId();
  const target = usable.find((page) => page.id === last) ?? usable[0];
  return target ? switchTo(target.id, userId) : null;
}
