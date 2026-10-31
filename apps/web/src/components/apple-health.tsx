'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Heart, RefreshCw } from 'lucide-react';
import type { ActivityAdjustment } from '@life-portal/shared-types';
import { api, API_URL } from '../lib/api';
import { revalidate, useApi } from '../lib/hooks';
import { useAuth } from '../lib/auth-context';
import { ErrorNote, Panel } from './ui';
interface HealthStatus {
  paired: boolean;
  lastSync?: string;
  installationUrl?: string;
}
const FRESH_MS = 300000;

/** One bridge in AppShell owns launches; panels request a manual launch by event. */
export function HealthSyncBridge({ enabled }: { enabled: boolean }) {
  const { user } = useAuth();
  const [fallback, setFallback] = useState(false);
  const [message, setMessage] = useState('');
  const running = useRef(false);
  const preparedLaunch = useRef<{ url: string; expiresAt: number } | null>(
    null,
  );
  const pollUntil = useRef(0);
  const check = useCallback(
    async (manual = false) => {
      // Retry an already prepared URL synchronously within the user's tap.
      // Awaiting another network request here could lose Safari's user gesture.
      if (
        manual &&
        preparedLaunch.current &&
        preparedLaunch.current.expiresAt > Date.now()
      ) {
        if (user)
          sessionStorage.setItem(
            `lp.health.attempt.v1.${user.id}`,
            String(Date.now()),
          );
        pollUntil.current = Date.now() + 90000;
        window.location.assign(preparedLaunch.current.url);
        return;
      }
      if (
        !enabled ||
        !user ||
        running.current ||
        document.visibilityState !== 'visible'
      )
        return;
      running.current = true;
      try {
        const status = await api.get<HealthStatus>('/nutrition/health');
        if (!status.paired || !status.installationUrl) {
          preparedLaunch.current = null;
          setFallback(false);
          return;
        }
        const key = `lp.health.attempt.v1.${user.id}`;
        const lastAttempt = Number(sessionStorage.getItem(key) ?? 0);
        const stale =
          !status.lastSync ||
          Date.now() - Date.parse(status.lastSync) >= FRESH_MS;
        if (!stale) {
          preparedLaunch.current = null;
          setFallback(false);
          setMessage('');
          return;
        }
        setFallback(true);
        if (
          !manual &&
          (!status.lastSync ||
            Date.now() - lastAttempt < FRESH_MS ||
            !/iPhone|iPad|iPod/.test(navigator.userAgent))
        )
          return;
        if (manual && Date.now() - lastAttempt < 15000) {
          setMessage('Please wait a few seconds before retrying.');
          return;
        }
        sessionStorage.setItem(key, String(Date.now()));
        const ticket = await api.post<{
          token: string;
          from: string;
          to: string;
        }>('/nutrition/health/launch');
        const input = JSON.stringify({
          ...ticket,
          uploadUrl: new URL(
            `${API_URL}/nutrition/health/upload`,
            window.location.origin,
          ).href,
        });
        const callback = `${window.location.origin}${window.location.pathname}?health-return=1`;
        const url = new URL('shortcuts://x-callback-url/run-shortcut');
        url.searchParams.set('input', 'text');
        url.searchParams.set('text', input);
        for (const key of ['x-success', 'x-cancel', 'x-error'])
          url.searchParams.set(key, callback);
        // iOS Shortcuts requires the name parameter with spaces, not + or %20
        const shortcutUrl = url
          .toString()
          .replace('run-shortcut?', 'run-shortcut?name=Life Portal Health&');
        preparedLaunch.current = {
          url: shortcutUrl,
          expiresAt: Date.now() + 14 * 60000,
        };
        pollUntil.current = Date.now() + 90000;
        setMessage(
          'Waiting for a valid Health upload. If Shortcuts did not open, tap Sync Health.',
        );
        window.location.assign(shortcutUrl);
      } catch (e) {
        setMessage(
          e instanceof Error ? e.message : 'Health sync could not start.',
        );
        setFallback(true);
      } finally {
        running.current = false;
      }
    },
    [enabled, user],
  );
  useEffect(() => {
    const callback = new URL(window.location.href);
    const returned = callback.searchParams.has('health-return');
    if (returned) {
      callback.searchParams.delete('health-return');
      window.history.replaceState(null, '', callback);
      pollUntil.current = Date.now() + 90000;
      // A callback means only that Shortcuts returned; it never proves an upload succeeded.
      void revalidate('/nutrition');
      void revalidate('/dashboard');
    } else void check();
    const resume = () => {
      if (document.visibilityState === 'visible') {
        void revalidate('/nutrition/health');
        void check();
      }
    };
    const manual = () => {
      void check(true);
    };
    window.addEventListener('lp-health-sync', manual);
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('focus', resume);
    const timer = window.setInterval(() => {
      if (
        Date.now() < pollUntil.current &&
        document.visibilityState === 'visible'
      ) {
        void revalidate('/nutrition');
        void revalidate('/dashboard');
        void check();
      }
    }, 15000);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('lp-health-sync', manual);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('focus', resume);
    };
  }, [check]);
  if (!fallback) return null;
  return (
    <div
      className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-2 text-xs text-ink-muted"
      role="status"
    >
      <button className="btn" onClick={() => void check(true)}>
        <RefreshCw size={14} /> Sync Health
      </button>
      <span>
        {message ||
          'Health is missing or stale. Tap to sync if your browser needs a gesture.'}
      </span>
    </div>
  );
}
export function AppleHealthPanel({
  activity,
}: {
  activity?: ActivityAdjustment;
}) {
  const status = useApi<HealthStatus>('/nutrition/health', {
    revalidateOnFocus: true,
    refreshInterval: 15000,
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function pair() {
    setBusy(true);
    setError('');
    try {
      await api.post('/nutrition/health/pair');
      await status.mutate();
      window.dispatchEvent(new Event('lp-health-sync'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not pair.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel
      title="Apple Health"
      description="A shared Apple Shortcut reads Health on your iPhone and sends a scoped upload. You control permissions; you can revoke this connection anytime."
    >
      <div className="space-y-3 text-sm">
        <Heart className="text-rose-400" />
        {status.data?.installationUrl ? (
          <p>
            1. Install{' '}
            <a
              className="text-accent underline"
              href={status.data.installationUrl}
            >
              Life Portal Health
            </a>{' '}
            on your iPhone. Keep its name so Life Portal can open it.
          </p>
        ) : (
          <p role="status" className="rounded-xl bg-amber-500/10 p-3">
            Apple Health setup is waiting for the shared Shortcut to be signed
            and published. Your profile-based estimates remain available. You
            can skip this step and return later.
          </p>
        )}
        <p>
          2. Tap Pair & first sync. Allow Shortcuts to read Active Energy and
          Steps, and allow the upload to Life Portal. No account password is
          shared with the Shortcut.
        </p>
        <p>
          3. Return here and wait for “First sync received.” Missing permission
          or no samples does not establish inactivity. Workout export depends on
          what your iOS version exposes; unavailable workouts stay unknown.
        </p>
        <p className="text-xs text-ink-muted">
          The Shortcut requires an iPhone installation and export check. If
          installation or permissions fail, skip this step and retry here later.
          Automatic opening can require iOS confirmation or a tap; background
          execution is not guaranteed.
        </p>
        {status.error && (
          <ErrorNote message={(status.error as Error).message} />
        )}
        {error && <ErrorNote message={error} />}
        <p role="status" className="font-medium">
          {status.data?.lastSync
            ? `First sync received · ${new Date(status.data.lastSync).toLocaleString()}`
            : status.data?.paired
              ? 'Paired — waiting for first valid upload'
              : 'Not connected'}
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            disabled={busy || !status.data?.installationUrl}
            className="btn-primary"
            onClick={() =>
              status.data?.paired
                ? window.dispatchEvent(new Event('lp-health-sync'))
                : void pair()
            }
          >
            {status.data?.paired ? 'Sync / retry' : 'Pair & first sync'}
          </button>
          {status.data?.paired && (
            <button
              className="btn"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api.delete('/nutrition/health');
                  await status.mutate();
                  await revalidate('/nutrition');
                  await revalidate('/dashboard');
                } catch (e) {
                  setError(
                    e instanceof Error ? e.message : 'Could not revoke.',
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              Revoke connection & delete uploads
            </button>
          )}
        </div>
        {activity && (
          <dl className="grid grid-cols-2 gap-2 rounded-xl bg-violet-500/10 p-4">
            {[
              ['Starting target', `${activity.startingTargetKcal} kcal`],
              ['Active energy recorded', `${activity.recordedActiveKcal} kcal`],
              [
                'Expected activity replaced',
                `${activity.expectedReplacedKcal} kcal`,
              ],
              [
                'Activity adjustment',
                `${activity.adjustmentKcal >= 0 ? '+' : ''}${activity.adjustmentKcal} kcal`,
              ],
              ['Current target', `${activity.currentTargetKcal} kcal`],
              ['Steps received', activity.steps.toLocaleString()],
              [
                'Workouts received',
                activity.workouts
                  ? String(activity.workouts)
                  : 'No workout data received',
              ],
              [
                'Tracking',
                activity.status === 'missing'
                  ? 'Missing — forecast retained'
                  : activity.status === 'stale'
                    ? 'Stale / partial — forecast retained'
                    : 'Partial — uncertain periods retain forecast',
              ],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-ink-muted">{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
            <p className="col-span-2 mt-2 text-xs text-ink-muted">
              Energy is an estimate. Only matching sampled periods replace
              expected movement, with a 07:00–23:00 forecast. Uncertain tracking
              never lowers your target. Step and workout calories are already
              part of active energy and are not added again. Steps-only data
              does not change your target.
            </p>
          </dl>
        )}
      </div>
    </Panel>
  );
}
