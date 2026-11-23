'use client';

import { useState } from 'react';
import {
  ASSISTANT_ACTION_KINDS,
  ASSISTANT_ACTION_LABELS,
  ASSISTANT_CAP_MAX,
  ASSISTANT_CAP_NONE,
  type AssistantActivity,
  type AssistantCaps,
  type MyPages,
} from '@life-portal/shared-types';
import { api } from '../lib/api';
import { revalidate, useAction, useApi } from '../lib/hooks';
import { ErrorNote, Input } from './ui';

/**
 * Spec 041: the person's consent for a linked AI assistant to act as their pages. Off until
 * they turn it on, and it covers only pages marked "run with AI".
 */
export function AssistantPagesConsent() {
  const pages = useApi<MyPages>('/pages');
  const action = useAction();
  if (!pages.data || (!pages.data.pages.length && pages.data.remaining === 0)) return null;
  const usable = pages.data.pages.filter((page) => page.aiManaged && !page.suspended);
  return (
    <section className="card mb-4 space-y-2 p-4 text-sm">
      <h2 className="font-semibold">Pages</h2>
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          className="mt-0.5 h-5 w-5 shrink-0 accent-[rgb(var(--accent))]"
          checked={pages.data.assistant}
          disabled={action.pending}
          onChange={(event) =>
            void action.run(
              async () => {
                await api.put('/pages/assistant', { enabled: event.target.checked });
                await revalidate('/pages');
              },
              { revalidate: false },
            )
          }
        />
        <span>
          Let a connected assistant manage my pages
          <span className="block text-xs text-ink-muted">
            It can create pages, and post, comment, like, follow and answer messages as a page. Only pages marked “run with AI”
            can be used, and a page it creates is marked so. Everything it does is listed on the page’s profile, and there are
            daily limits. Turn this off and it stops at once.
          </span>
        </span>
      </label>
      {pages.data.assistant && (
        <p className="text-xs text-ink-faint">
          {usable.length
            ? `Usable now: ${usable.map((page) => page.name).join(', ')}.`
            : 'None of your pages is marked “run with AI” yet. Mark one from its profile, or ask the assistant to create a page.'}
        </p>
      )}
      {action.error && <ErrorNote message={action.error} />}
    </section>
  );
}

const capText = (cap: number | null) => (cap === null ? 'no limit' : String(cap));

/** For a page's managers: what the assistant did as the page, and today's use against its limits. */
export function AssistantActivityPanel({ pageId }: { pageId: string }) {
  const [open, setOpen] = useState(false);
  const activity = useApi<AssistantActivity>(open ? `/page-assistant/activity/${pageId}` : null);
  return (
    <details className="text-xs text-ink-muted" onToggle={(event) => setOpen((event.target as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer">What the assistant did as this page</summary>
      {!activity.data ? (
        <p className="mt-2">{activity.error ? (activity.error as Error).message : 'Loading…'}</p>
      ) : (
        <div className="mt-2 space-y-2">
          <p>
            Today:{' '}
            {activity.data.today.map((row) => `${ASSISTANT_ACTION_LABELS[row.kind].toLowerCase()} ${row.used}/${capText(row.cap)}`).join(' · ')}
          </p>
          {activity.data.actions.length === 0 ? (
            <p>Nothing yet.</p>
          ) : (
            <ul className="space-y-0.5">
              {activity.data.actions.map((action) => (
                <li key={action.id}>
                  {new Date(action.createdAt).toLocaleString()} · {action.tool.replace(/_/g, ' ')}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </details>
  );
}

const asText = (value: number | undefined) => (value === undefined ? '' : value === ASSISTANT_CAP_NONE ? 'none' : String(value));
const parse = (text: string): number | undefined | null => {
  const value = text.trim().toLowerCase();
  if (!value) return undefined;
  if (value === 'none') return ASSISTANT_CAP_NONE;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= ASSISTANT_CAP_MAX ? number : null;
};

/**
 * The owner's editor for the assistant's daily limits per page: the defaults for everyone
 * (`personId` absent), or one person's override. A number, "none" for no limit, or empty to
 * use the default (override only).
 */
export function AssistantCapsEditor({ personId, current, onSaved }: { personId?: string; current?: Partial<AssistantCaps>; onSaved?: () => void }) {
  const defaults = useApi<AssistantCaps>('/page-assistant/caps');
  const action = useAction();
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const base = personId ? current : defaults.data;
  const values = draft ?? Object.fromEntries(ASSISTANT_ACTION_KINDS.map((kind) => [kind, asText(base?.[kind])]));
  const parsed = ASSISTANT_ACTION_KINDS.map((kind) => [kind, parse(values[kind] ?? '')] as const);
  const invalid = parsed.some(([, value]) => value === null || (!personId && value === undefined));
  const save = (caps: Record<string, number> | null) =>
    action
      .run(
        async () => {
          await api.put(personId ? `/page-assistant/caps/${personId}` : '/page-assistant/caps', { caps });
          await Promise.all([revalidate('/page-assistant'), revalidate('/people-admin')]);
        },
        { revalidate: false },
      )
      .then((ok) => {
        if (ok) {
          setDraft(null);
          onSaved?.();
        }
      });
  return (
    <details className="text-xs text-ink-muted">
      <summary className="cursor-pointer">
        {personId
          ? `Assistant limits: ${current && Object.keys(current).length ? 'custom' : 'default'}`
          : 'Assistant limits for everyone (per page, per day)'}
      </summary>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {ASSISTANT_ACTION_KINDS.map((kind) => (
          <label key={kind} className="space-y-1">
            <span>{ASSISTANT_ACTION_LABELS[kind]}</span>
            <Input
              aria-label={ASSISTANT_ACTION_LABELS[kind]}
              placeholder={personId ? `default ${capText(defaults.data?.[kind] === ASSISTANT_CAP_NONE ? null : (defaults.data?.[kind] ?? null))}` : 'number or none'}
              value={values[kind] ?? ''}
              onChange={(event) => setDraft({ ...values, [kind]: event.target.value })}
            />
          </label>
        ))}
      </div>
      <p className="mt-2">A whole number, or “none” for no limit.{personId ? ' Empty uses the default.' : ''}</p>
      {action.error && <ErrorNote message={action.error} />}
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-ghost"
          disabled={invalid || action.pending}
          onClick={() => {
            const caps = Object.fromEntries(parsed.filter(([, value]) => typeof value === 'number')) as Record<string, number>;
            void save(personId && !Object.keys(caps).length ? null : caps);
          }}
        >
          Save
        </button>
        {personId && (
          <>
            <button
              type="button"
              className="btn-ghost"
              disabled={action.pending}
              onClick={() => void save(Object.fromEntries(ASSISTANT_ACTION_KINDS.map((kind) => [kind, ASSISTANT_CAP_NONE])))}
            >
              No limits
            </button>
            <button type="button" className="btn-ghost" disabled={action.pending} onClick={() => void save(null)}>
              Default
            </button>
          </>
        )}
      </div>
    </details>
  );
}
