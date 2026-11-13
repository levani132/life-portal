'use client';

import clsx from 'clsx';
import { useState } from 'react';
import {
  FOR_YOU_INTERESTS,
  type FeedMetricsStatus,
  type FeedPreferences,
  type PortalState,
} from '@life-portal/shared-types';
import { formatDay } from '@life-portal/shared-domain';
import { api } from '../lib/api';
import { useApi } from '../lib/hooks';
import { ErrorNote, Panel, Spinner } from './ui';

/**
 * For You interests and "Reset recommendations" (#10). Interests are the viewer's explicit,
 * private choices, used by For You only; never shown on a profile, never inferred. They only lift
 * matching posts when personalised ranking (#9) is on, so the copy says "will" until then.
 */

export const PREFERENCES_KEY = '/posts/for-you/preferences';

/** For You and everything it needs; the setup step and Settings section show only with it. */
export const hasForYou = (portal?: PortalState) =>
  !!portal && portal.access.forYou && portal.access.social && portal.access.foodPosts && portal.access.nutrition;

export function interestsCopy(ranking: boolean) {
  return ranking
    ? 'Posts that match lift a little in For You, alongside others, so you still discover new things.'
    : 'For You will use these once personalised ranking is turned on. Until then it stays newest first.';
}

/** Tap to choose or un-choose. Each change is saved at once. */
export function InterestPicker() {
  const { data, error, mutate } = useApi<FeedPreferences>(PREFERENCES_KEY);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (error) return <ErrorNote message={(error as Error).message} />;
  if (!data) return <Spinner />;
  const current = data.interests;
  const chosen = new Set(current);
  async function toggle(id: string) {
    const interests = chosen.has(id) ? current.filter((item) => item !== id) : [...current, id];
    setSaving(true);
    setProblem(null);
    try {
      await mutate(await api.put<FeedPreferences>(PREFERENCES_KEY, { interests }), { revalidate: false });
    } catch (caught) {
      setProblem(caught instanceof Error ? caught.message : 'Could not save your interests.');
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="space-y-4">
      {(['diet', 'general'] as const).map((group) => (
        <div key={group} role="group" aria-label={group === 'diet' ? 'Diet' : 'Food and life'}>
          <p className="mb-2 text-xs font-medium text-ink-muted">{group === 'diet' ? 'Diet' : 'Food and life'}</p>
          <div className="flex flex-wrap gap-2">
            {FOR_YOU_INTERESTS.filter((interest) => interest.group === group).map((interest) => {
              const on = chosen.has(interest.id);
              return (
                <button
                  key={interest.id}
                  type="button"
                  aria-pressed={on}
                  disabled={saving}
                  onClick={() => void toggle(interest.id)}
                  className={clsx(
                    'rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
                    on ? 'border-transparent bg-accent-solid text-on-accent' : 'border-border text-ink-muted hover:text-ink',
                  )}
                >
                  {interest.label}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {problem && <ErrorNote message={problem} />}
      <p className="text-xs text-ink-faint">
        Private and optional. Used for For You only, never shown on your profile. Some interests have
        few posts yet; For You fills the rest with other posts.
      </p>
    </div>
  );
}

/** Settings → For You: interests, Clear interests, Reset recommendations. */
export function ForYouSettings({ portal }: { portal: PortalState }) {
  const { data, mutate } = useApi<FeedPreferences>(hasForYou(portal) ? PREFERENCES_KEY : null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (!hasForYou(portal)) return null;
  async function run(action: () => Promise<FeedPreferences>) {
    setBusy(true);
    setProblem(null);
    try {
      await mutate(await action(), { revalidate: false });
      setConfirming(false);
    } catch (caught) {
      setProblem(caught instanceof Error ? caught.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel title="For You" description={`Interests you choose. ${interestsCopy(portal.access.forYouRanking)}`}>
      <InterestPicker />
      <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
        <button
          type="button"
          className="btn-ghost"
          disabled={busy || !data?.interests.length}
          onClick={() => void run(() => api.put<FeedPreferences>(PREFERENCES_KEY, { interests: [] }))}
        >
          Clear interests
        </button>
        {!confirming ? (
          <button type="button" className="btn-ghost" disabled={busy} onClick={() => setConfirming(true)}>
            Reset recommendations
          </button>
        ) : (
          <div className="w-full rounded-xl border border-border p-3 text-sm" role="alertdialog" aria-label="Reset recommendations">
            <p>
              For You will stop using your likes, comments and reposts from before now. They stay where
              they are; only For You forgets them. Your interests are kept.
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                className="btn-primary"
                disabled={busy}
                onClick={() => void run(() => api.post<FeedPreferences>('/posts/for-you/reset', {}))}
              >
                Reset
              </button>
              <button type="button" className="btn-ghost" onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
      {data?.recommendationsResetAt && (
        <p className="mt-2 text-xs text-ink-faint">
          Last reset {formatDay(data.recommendationsResetAt.slice(0, 10))}.
        </p>
      )}
      {problem && <ErrorNote message={problem} />}
      <MeasurementSettings />
    </Panel>
  );
}

/** Same key as the For You feed, so opting out here stops a page that is already open. */
export const METRICS_KEY = '/posts/for-you/metrics';

/**
 * For You measurement (#11): what is collected, how long it is kept, who sees it, and the opt-out.
 * Shown whether or not measurement is on, so the opt-out can be set before it ever is.
 */
export function MeasurementSettings() {
  const { data, error, mutate } = useApi<FeedMetricsStatus>(METRICS_KEY);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (error) return <ErrorNote message={(error as Error).message} />;
  if (!data) return null;
  async function toggle(optedOut: boolean) {
    setBusy(true);
    setProblem(null);
    try {
      await mutate(await api.put<FeedMetricsStatus>(METRICS_KEY, { optedOut }), { revalidate: false });
    } catch (caught) {
      setProblem(caught instanceof Error ? caught.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="mt-4 border-t border-border pt-4" aria-label="For You measurement">
      <h3 className="text-sm font-medium">Measurement</h3>
      <p className="mt-1 text-sm text-ink-muted">{measurementState(data)}</p>
      <details className="mt-2 text-xs text-ink-muted">
        <summary className="cursor-pointer text-ink">What is measured and kept</summary>
        <ul className="mt-2 list-disc space-y-1 pl-4">
          <li>
            Daily totals for For You: posts at least half on screen for a second, how far videos
            played, and likes, comments, reposts and Not interested made from For You.
          </li>
          <li>The totals carry no name or account, and are deleted after 90 days.</li>
          <li>
            To count each thing once, coded keys made from your account are kept for 2 days (8 for
            visits). They are pseudonymous, not anonymous: the server can recompute them.
          </li>
          <li>Only the app&apos;s developer sees the totals. They do not change what For You shows you.</li>
          <li>Turning this off stops counting at once and deletes your keys.</li>
        </ul>
      </details>
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={data.optedOut}
          disabled={busy}
          className="h-4 w-4 rounded border-border bg-surface"
          onChange={(event) => void toggle(event.target.checked)}
        />
        Don&apos;t measure my For You viewing
      </label>
      {problem && <ErrorNote message={problem} />}
    </section>
  );
}

export function measurementState(status: FeedMetricsStatus) {
  if (status.optedOut) return 'Off: you opted out. Nothing about your For You viewing is counted.';
  if (!status.enabled) return 'Not running for your account. Nothing about your For You viewing is counted.';
  return 'On: your For You viewing is counted in daily totals.';
}
