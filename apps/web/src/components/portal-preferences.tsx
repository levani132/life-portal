'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowDown, ArrowUp, Check, ShieldCheck } from 'lucide-react';
import {
  MODULES,
  type Audience,
  type ModuleId,
  type PortalPreferences,
  type PortalState,
} from '@life-portal/shared-types';
import { api } from '../lib/api';
import { revalidate, useApi } from '../lib/hooks';
import { ErrorNote, Select, Spinner } from './ui';

export function PortalPreferencesPanel({
  mode,
}: {
  mode: 'setup' | 'modules' | 'privacy';
}) {
  const { data, error, isLoading } = useApi<PortalState>('/portal');
  if (isLoading) return <Spinner />;
  if (error) return <ErrorNote message={(error as Error).message} />;
  return data ? <PreferencesEditor initial={data} mode={mode} /> : null;
}
const CARD_ID: Record<ModuleId, string> = {
  nutrition: 'nutrition',
  money: 'cashflow',
  stocks: 'stocks',
  loans: 'loans',
  items: 'items',
  personal: 'personal',
  projects: 'projects',
  epam: 'board:epam',
};
const STEPS = ['Your modules', 'Your privacy', 'Your Home', 'Ready to begin'];
function PreferencesEditor({
  initial,
  mode,
}: {
  initial: PortalState;
  mode: 'setup' | 'modules' | 'privacy';
}) {
  const router = useRouter();
  const [selected, setSelected] = useState(initial.selectedModules);
  const [visibility, setVisibility] = useState(initial.moduleVisibility);
  const [order, setOrder] = useState(() => {
    const available = MODULES.filter((m) => initial.access[m.id]).map(
      (m) => m.id,
    );
    const rank = (id: ModuleId) => {
      const i = initial.widgetOrder.indexOf(CARD_ID[id]);
      return i < 0 ? 100 + available.indexOf(id) : i;
    };
    return available.sort((a, b) => rank(a) - rank(b));
  });
  const [step, setStep] = useState(
    initial.setupCompleted ? 0 : initial.setupStep,
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const isSetup = mode === 'setup';
  const active = isSetup ? step : mode === 'privacy' ? 1 : 0;
  const available = MODULES.filter((m) => initial.access[m.id]);
  const visibleOrder = order.filter((id) => selected.includes(id));
  async function save(extra: PortalPreferences = {}, destination?: string) {
    setPending(true);
    setError(null);
    setSaved(false);
    try {
      // Preserve inactive module choices when flags temporarily remove availability.
      const ids = order.map((id) => CARD_ID[id]);
      await api.put('/portal', {
        selectedModules: selected,
        moduleVisibility: visibility,
        widgetOrder: [
          ...ids,
          ...initial.widgetOrder.filter((id) => !ids.includes(id)),
        ],
        ...extra,
      });
      await revalidate('/portal');
      await revalidate('/dashboard');
      setSaved(true);
      if (destination) router.push(destination);
      else if (extra.setupStep !== undefined) setStep(extra.setupStep);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not save your choices.',
      );
    } finally {
      setPending(false);
    }
  }
  function move(id: ModuleId, delta: number) {
    const from = visibleOrder.indexOf(id);
    const other = visibleOrder[from + delta];
    if (!other) return;
    setOrder((current) => {
      const next = [...current];
      const a = next.indexOf(id);
      const b = next.indexOf(other);
      [next[a], next[b]] = [next[b], next[a]];
      return next;
    });
    setSaved(false);
  }
  return (
    <div className="mx-auto max-w-2xl">
      {isSetup && (
        <>
          <p className="mb-3 text-xs font-medium uppercase tracking-widest text-sky-300">
            Make room for what matters
          </p>
          <div className="mb-6 flex gap-2" aria-label={`Step ${step + 1} of 4`}>
            {STEPS.map((label, i) => (
              <span
                key={label}
                className={`h-1 flex-1 rounded-full ${i <= step ? 'bg-sky-400' : 'bg-surface-raised'}`}
              />
            ))}
          </div>
        </>
      )}
      <h1 className="text-2xl font-semibold tracking-tight">
        {isSetup
          ? STEPS[step]
          : mode === 'privacy'
            ? 'Privacy and sharing'
            : 'Manage modules'}
      </h1>
      <p className="mb-6 mt-2 text-sm text-ink-muted">
        {active === 0
          ? 'Choose what you want to manage. You can change this anytime.'
          : active === 1
            ? 'Everything starts private. Choose who can see each widget on your profile and in Friends.'
            : active === 2
              ? 'Put the things you use most at the top.'
              : 'Your portal is ready. Start with one small thing.'}
      </p>
      {error && (
        <div className="mb-4" role="alert">
          <ErrorNote message={error} />
        </div>
      )}
      <fieldset disabled={pending} className="space-y-3">
        <legend className="sr-only">{STEPS[active]}</legend>
        {active === 0 &&
          available.map((module) => (
            <label
              key={module.id}
              className={`card flex cursor-pointer items-center gap-4 p-5 ${selected.includes(module.id) ? 'border-sky-500/50 bg-sky-500/5' : ''}`}
            >
              <input
                type="checkbox"
                className="h-5 w-5 shrink-0 accent-sky-400"
                checked={selected.includes(module.id)}
                onChange={(event) => {
                  setSelected((current) =>
                    event.target.checked
                      ? [...current, module.id]
                      : current.filter((id) => id !== module.id),
                  );
                  setSaved(false);
                }}
              />
              <span>
                <span className="block font-medium">{module.name}</span>
                <span className="mt-1 block text-sm text-ink-muted">
                  {module.description}
                </span>
              </span>
            </label>
          ))}
        {active === 1 && (
          <>
            <div className="mb-4 flex items-start gap-3 rounded-xl bg-emerald-500/5 p-4 text-sm text-ink-muted">
              <ShieldCheck size={22} className="shrink-0 text-emerald-400" />
              <p>
                These choices control the live widgets on your shared profile.
                Sharing a food or posting a meal is a separate action. Food’s
                existing weight and target controls still apply.
              </p>
            </div>
            {available
              .filter((m) => selected.includes(m.id))
              .map((module) => (
                <label
                  key={module.id}
                  className="card flex flex-wrap items-center justify-between gap-3 p-4"
                >
                  <span className="font-medium">{module.name}</span>
                  <span className="w-40">
                    <Select
                      aria-label={`${module.name} audience`}
                      value={visibility[module.id]}
                      onChange={(event) => {
                        setVisibility((current) => ({
                          ...current,
                          [module.id]: event.target.value as Audience,
                        }));
                        setSaved(false);
                      }}
                    >
                      <option value="private">Only me</option>
                      {module.id !== 'epam' && (
                        <>
                          <option value="friends">Friends</option>
                          <option value="public">
                            Everyone in Life Portal
                          </option>
                        </>
                      )}
                    </Select>
                  </span>
                </label>
              ))}
            {selected.length === 0 && (
              <p className="card p-5 text-sm text-ink-muted">
                Your portal is private. Add a module whenever you’re ready.
              </p>
            )}
          </>
        )}
        {active === 2 && (
          <>
            {visibleOrder.map((id, index) => (
              <div
                key={id}
                className="card flex items-center justify-between gap-4 p-4"
              >
                <span>
                  <span className="mr-3 text-ink-faint">{index + 1}.</span>
                  {MODULES.find((m) => m.id === id)?.name}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="btn"
                    aria-label={`Move ${MODULES.find((m) => m.id === id)?.name} up`}
                    disabled={index === 0}
                    onClick={() => move(id, -1)}
                  >
                    <ArrowUp size={18} />
                  </button>
                  <button
                    type="button"
                    className="btn"
                    aria-label={`Move ${MODULES.find((m) => m.id === id)?.name} down`}
                    disabled={index === visibleOrder.length - 1}
                    onClick={() => move(id, 1)}
                  >
                    <ArrowDown size={18} />
                  </button>
                </div>
              </div>
            ))}
            {visibleOrder.length === 0 && (
              <p className="card p-5 text-sm text-ink-muted">
                You can add modules from Menu later.
              </p>
            )}
            <p className="pt-2 text-xs text-ink-faint">
              Friends can preview your first two widgets that they’re allowed to
              see.
            </p>
          </>
        )}
        {active === 3 && (
          <div className="card p-6">
            <Check className="mb-4 text-emerald-400" size={28} />
            <p className="font-medium">
              A little more organised, one day at a time.
            </p>
            <p className="mt-2 text-sm text-ink-muted">
              {selected.includes('nutrition')
                ? 'Try logging your first food. Nutrition goals and body measurements can wait until you want them.'
                : 'Open a module from Home whenever you’re ready.'}
            </p>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3 pt-4">
          {isSetup && step > 0 && (
            <button
              className="btn"
              type="button"
              onClick={() => void save({ setupStep: step - 1 })}
            >
              Back
            </button>
          )}
          {isSetup && step < 3 ? (
            <button
              className="btn btn-primary"
              type="button"
              onClick={() => void save({ setupStep: step + 1 })}
            >
              {pending ? 'Saving…' : 'Continue'}
            </button>
          ) : (
            <button
              className="btn btn-primary"
              type="button"
              onClick={() =>
                void save(
                  isSetup
                    ? {
                        setupCompleted: true,
                        setupDismissed: false,
                        setupStep: 3,
                      }
                    : {},
                  isSetup ? '/' : undefined,
                )
              }
            >
              {pending ? 'Saving…' : isSetup ? 'Go to my Home' : 'Save changes'}
            </button>
          )}
          {isSetup && step === 3 && selected.includes('nutrition') && (
            <button
              className="btn"
              type="button"
              onClick={() =>
                void save(
                  { setupCompleted: true, setupDismissed: false, setupStep: 3 },
                  '/nutrition?log=1',
                )
              }
            >
              Log my first food
            </button>
          )}
          {isSetup && step < 3 && (
            <button
              className="px-2 py-3 text-sm text-ink-muted"
              type="button"
              onClick={() =>
                void save({ setupStep: step, setupDismissed: true }, '/')
              }
            >
              Finish later
            </button>
          )}
          {!isSetup && saved && (
            <span className="text-sm text-emerald-400" role="status">
              Saved
            </span>
          )}
        </div>
      </fieldset>
      {active === 1 && (
        <div className="mt-6 space-y-3 text-sm">
          {initial.access.social && (
            <Link
              className="block text-sky-300 hover:underline"
              href="/profile"
            >
              Preview my shared profile →
            </Link>
          )}
          {initial.access.nutrition && (
            <p className="text-ink-muted">
              Food also keeps separate controls for meals, weight and targets.{' '}
              <Link
                className="text-sky-300 hover:underline"
                href="/nutrition?tab=you"
              >
                Choose Food details →
              </Link>
            </p>
          )}
          {!initial.access.social && (
            <p className="text-xs text-ink-faint">
              Social sharing is not enabled for your account yet. Your audience
              choices will be ready when it is.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
