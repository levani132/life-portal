'use client';

import clsx from 'clsx';
import { useMemo, useState, type CSSProperties } from 'react';
import { mutate } from 'swr';
import { Check, Copy, Pencil, Trash2 } from 'lucide-react';
import {
  THEME_NAME_MAX,
  THEME_ROLES,
  type PortalState,
  type Theme,
  type ThemeList,
  type ThemeRole,
  type ThemeValues,
} from '@life-portal/shared-types';
import { colourToHex, hexToColour, themeProblems, type ReadabilityProblem } from '@life-portal/shared-domain';
import { AppShell, PageHeader } from '../../../components/app-shell';
import { ACTIVE_THEME_KEY } from '../../../components/theme-loader';
import { Chip, ErrorNote, Field, Input, Panel, Spinner } from '../../../components/ui';
import { ApiError, api } from '../../../lib/api';
import { useApi } from '../../../lib/hooks';

export default function ThemesPage() {
  return (
    <AppShell>
      <Themes />
    </AppShell>
  );
}

const THEMES_KEY = '/themes';
type Mode = 'light' | 'dark';
const GROUPS = [...new Set(THEME_ROLES.map((role) => role.group))];

const problemText = (problem: ReadabilityProblem) =>
  `${problem.mode === 'light' ? 'Light' : 'Dark'}: ${problem.what} is ${problem.ratio}:1, needs ${problem.min}:1.`;

/** The server's readability refusal carries the same list the editor shows. */
function refusal(error: unknown): string {
  if (error instanceof ApiError && error.code === 'THEME_UNREADABLE') {
    const problems = (error.body?.['problems'] as ReadabilityProblem[] | undefined) ?? [];
    return [error.message, ...problems.map(problemText)].join(' ');
  }
  return error instanceof Error ? error.message : 'Something went wrong.';
}

/**
 * Colour themes (spec 037), developer only. A theme is one colour per role, for light and for
 * dark; the active one is what every account sees. v0 is the original look and cannot be
 * changed, so a new theme always starts as a copy.
 */
function Themes() {
  const portal = useApi<PortalState>('/portal');
  const allowed = portal.data?.cohort === 'developer';
  const list = useApi<ThemeList>(allowed ? THEMES_KEY : null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!portal.data) return <Spinner />;
  if (!allowed) return <ErrorNote message="Themes are managed by the developer." />;

  async function run(key: string, action: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await action();
      await Promise.all([list.mutate(), mutate(ACTIVE_THEME_KEY)]);
    } catch (caught) {
      setError(refusal(caught));
    } finally {
      setBusy(null);
    }
  }

  const editing = list.data?.themes.find((theme) => theme.id === editingId && !theme.builtIn);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title="Themes" subtitle="The colours everyone sees. One theme is active for the whole app." />
      {error && <ErrorNote message={error} />}
      {list.error ? (
        <ErrorNote message={(list.error as Error).message} />
      ) : !list.data ? (
        <Spinner />
      ) : (
        <ul className="space-y-2">
          {list.data.themes.map((theme) => {
            const active = theme.id === list.data?.activeId;
            const problems = themeProblems(theme);
            return (
              <li key={theme.id} className="card p-4">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <Swatches theme={theme} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{theme.name}</p>
                    <p className="flex flex-wrap items-center gap-1.5 text-xs text-ink-faint">
                      {active && <Chip tone="good">Active</Chip>}
                      {theme.builtIn && <Chip>Built in</Chip>}
                      {problems.length > 0 && <Chip tone="warn">{problems.length} readability {problems.length === 1 ? 'problem' : 'problems'}</Chip>}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {!active && (
                      <button
                        type="button"
                        className="btn-primary"
                        disabled={!!busy || problems.length > 0}
                        title={problems.length ? 'Fix the readability problems first' : undefined}
                        onClick={() => {
                          if (window.confirm(`Make "${theme.name}" the theme everyone sees?`))
                            void run(`activate:${theme.id}`, () => api.post(`/themes/${theme.id}/activate`));
                        }}
                      >
                        <Check className="h-4 w-4" /> Activate
                      </button>
                    )}
                    {!theme.builtIn && (
                      <button type="button" className="btn-ghost" onClick={() => setEditingId(editingId === theme.id ? null : theme.id)} aria-pressed={editingId === theme.id}>
                        <Pencil className="h-4 w-4" /> Edit
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn-ghost"
                      disabled={!!busy}
                      onClick={() => {
                        const name = window.prompt('Name for the copy', `${theme.builtIn ? 'New theme' : `${theme.name} copy`}`.slice(0, THEME_NAME_MAX));
                        if (name?.trim())
                          void run(`copy:${theme.id}`, async () => {
                            const created = await api.post<Theme>('/themes', { name: name.trim().slice(0, THEME_NAME_MAX), from: theme.id });
                            setEditingId(created.id);
                          });
                      }}
                    >
                      <Copy className="h-4 w-4" /> Duplicate
                    </button>
                    {!theme.builtIn && !active && (
                      <button
                        type="button"
                        className="btn-danger"
                        disabled={!!busy}
                        aria-label={`Delete ${theme.name}`}
                        onClick={() => {
                          if (window.confirm(`Delete "${theme.name}"? This cannot be undone.`))
                            void run(`delete:${theme.id}`, async () => {
                              await api.delete(`/themes/${theme.id}`);
                              if (editingId === theme.id) setEditingId(null);
                            });
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {editing && (
        <ThemeEditor
          key={`${editing.id}@${editing.version}`}
          theme={editing}
          active={editing.id === list.data?.activeId}
          onSaved={() => Promise.all([list.mutate(), mutate(ACTIVE_THEME_KEY)]).then(() => undefined)}
          onStale={() => list.mutate().then(() => undefined)}
        />
      )}
    </div>
  );
}

const SWATCH_ROLES = ['surface', 'surface-raised', 'ink', 'accent-solid', 'success-solid', 'warning-solid', 'danger-solid'];

function Swatches({ theme }: { theme: Theme }) {
  return (
    <span className="flex shrink-0 overflow-hidden rounded-lg border border-border" aria-hidden>
      {SWATCH_ROLES.map((role) => (
        <span key={role} className="h-9 w-3.5" style={{ backgroundColor: `rgb(${theme.light[role]})` }} />
      ))}
    </span>
  );
}

/** A subtree's colours come from these variables, so the preview shows unsaved values. */
const asVariables = (values: ThemeValues) =>
  Object.fromEntries(Object.entries(values).map(([role, value]) => [`--${role}`, value])) as CSSProperties;

function ThemeEditor({ theme, active, onSaved, onStale }: { theme: Theme; active: boolean; onSaved: () => Promise<void>; onStale: () => Promise<void> }) {
  const [name, setName] = useState(theme.name);
  const [values, setValues] = useState<Record<Mode, ThemeValues>>({ light: theme.light, dark: theme.dark });
  const [mode, setMode] = useState<Mode>('light');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problems = useMemo(() => themeProblems(values), [values]);
  const dirty = name !== theme.name || (['light', 'dark'] as const).some((m) => THEME_ROLES.some((role) => values[m][role.id] !== theme[m][role.id]));

  function setRole(role: string, colour: string) {
    setValues((current) => ({ ...current, [mode]: { ...current[mode], [role]: colour } }));
  }

  async function save() {
    setPending(true);
    setError(null);
    try {
      await api.patch<Theme>(`/themes/${theme.id}`, { name: name.trim(), light: values.light, dark: values.dark, baseVersion: theme.version });
      await onSaved();
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'STALE_EDIT') {
        setError('This theme was changed somewhere else. It has been reloaded; make your changes again.');
        await onStale();
      } else setError(refusal(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <Panel
      title={`Edit ${theme.name}`}
      description={active ? 'This theme is active: saving changes what everyone sees.' : 'Nothing changes for anyone until this theme is activated.'}
      actions={
        <button type="button" className="btn-primary" disabled={pending || !dirty || !name.trim() || (active && problems.length > 0)} onClick={() => void save()}>
          {pending ? 'Saving…' : 'Save'}
        </button>
      }
    >
      <div className="space-y-4">
        {error && <ErrorNote message={error} />}
        <Field label="Name">
          <Input value={name} maxLength={THEME_NAME_MAX} onChange={(event) => setName(event.target.value)} />
        </Field>
        <div className="flex gap-2" role="group" aria-label="Mode">
          {(['light', 'dark'] as const).map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={mode === item}
              onClick={() => setMode(item)}
              className={clsx(
                'rounded-full border px-3 py-1.5 text-sm font-medium',
                mode === item ? 'border-transparent bg-accent-solid text-on-accent' : 'border-border text-ink-muted',
              )}
            >
              {item === 'light' ? 'Light' : 'Dark'}
            </button>
          ))}
        </div>
        <Preview values={values[mode]} />
        {problems.length > 0 && (
          <ul className="space-y-1 rounded-xl bg-warning-solid/10 p-3 text-xs text-warning" role="status">
            {problems.map((problem) => (
              <li key={`${problem.mode}:${problem.what}`}>{problemText(problem)}</li>
            ))}
            <li className="text-ink-muted">A theme with readability problems cannot be activated.</li>
          </ul>
        )}
        {GROUPS.map((group) => (
          <fieldset key={group}>
            <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">{group}</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {THEME_ROLES.filter((role) => role.group === group).map((role) => (
                <RoleInput key={role.id} role={role} value={values[mode][role.id]} onChange={(colour) => setRole(role.id, colour)} />
              ))}
            </div>
          </fieldset>
        ))}
      </div>
    </Panel>
  );
}

function RoleInput({ role, value, onChange }: { role: ThemeRole; value: string; onChange: (colour: string) => void }) {
  const hex = colourToHex(value);
  // Typing a hex code: kept as typed until it is a whole colour.
  const [typed, setTyped] = useState<string | null>(null);
  return (
    <label className="flex items-center gap-2.5 rounded-xl border border-border p-2">
      <input
        type="color"
        value={hex}
        onChange={(event) => {
          const colour = hexToColour(event.target.value);
          if (colour) onChange(colour);
          setTyped(null);
        }}
        className="h-9 w-9 shrink-0 cursor-pointer rounded-lg border border-border bg-transparent p-0"
        aria-label={`${role.label} colour`}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{role.label}</span>
        <span className="block truncate text-[11px] text-ink-faint">{role.id}</span>
      </span>
      <Input
        value={typed ?? hex}
        onChange={(event) => {
          setTyped(event.target.value);
          const colour = hexToColour(event.target.value.trim());
          if (colour) onChange(colour);
        }}
        onBlur={() => setTyped(null)}
        className="w-24 shrink-0 font-mono"
        spellCheck={false}
        autoCapitalize="off"
        aria-label={`${role.label} hex code`}
      />
    </label>
  );
}

const STATUS = ['success', 'warning', 'danger', 'info', 'special', 'fresh'] as const;
const STATUS_CLASSES: Record<(typeof STATUS)[number], string> = {
  success: 'bg-success-solid/15 text-success',
  warning: 'bg-warning-solid/15 text-warning',
  danger: 'bg-danger-solid/15 text-danger',
  info: 'bg-info-solid/15 text-info',
  special: 'bg-special-solid/15 text-special',
  fresh: 'bg-fresh-solid/15 text-fresh',
};
const TRAIN_CLASSES = [
  'bg-train-push-solid',
  'bg-train-pull-solid',
  'bg-train-legs-solid',
  'bg-train-core-solid',
  'bg-train-arms-solid',
  'bg-train-cardio-solid',
];
const MACROS = [
  ['Calories', 'bg-macro-kcal', 'text-macro-kcal-text'],
  ['Protein', 'bg-macro-protein', 'text-macro-protein-text'],
  ['Carbs', 'bg-macro-carbs', 'text-macro-carbs-text'],
  ['Fat', 'bg-macro-fat', 'text-macro-fat-text'],
] as const;

/** A small piece of the app drawn in the theme being edited, in the chosen mode. */
function Preview({ values }: { values: ThemeValues }) {
  return (
    <div style={asVariables(values)} className="space-y-3 rounded-2xl border border-border bg-surface p-4 text-ink" aria-label="Preview">
      <div className="rounded-2xl border border-border bg-surface-raised p-4">
        <p className="text-base font-semibold">Today</p>
        <p className="text-sm text-ink-muted">Secondary text sits under a title like this.</p>
        <p className="text-xs text-ink-faint">Faint text for the least important details.</p>
        <p className="mt-2 text-sm">
          A <span className="font-medium text-accent underline">link in the accent colour</span> inside a sentence.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="rounded-xl bg-accent-solid px-3 py-2 text-sm font-semibold text-on-accent">Primary button</span>
          <span className="rounded-xl border border-border px-3 py-2 text-sm font-medium">Secondary</span>
          <span className="rounded-xl border border-danger-solid/40 px-3 py-2 text-sm font-medium text-danger">Delete</span>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {STATUS.map((status) => (
          <span key={status} className={clsx('rounded-full px-2.5 py-1 text-xs font-semibold capitalize', STATUS_CLASSES[status])}>
            {status}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {MACROS.map(([label, dot, text]) => (
          <span key={label} className={clsx('flex items-center gap-1.5 text-xs font-semibold', text)}>
            <span className={clsx('h-2.5 w-2.5 rounded-full', dot)} /> {label}
          </span>
        ))}
      </div>
      <div className="flex gap-1.5">
        {TRAIN_CLASSES.map((item) => (
          <span key={item} className={clsx('h-6 flex-1 rounded-lg', item)} />
        ))}
      </div>
    </div>
  );
}
