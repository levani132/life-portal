'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Heart, RefreshCw } from 'lucide-react';
import type { ActivityAdjustment } from '@life-portal/shared-types';
import { api, API_URL } from '../lib/api';
import { revalidate, useApi } from '../lib/hooks';
import { useAuth } from '../lib/auth-context';
import { healthShortcutUrl, healthSyncDue } from '../lib/health-sync';
import { ErrorNote, Panel } from './ui';
import { HealthShortcutDialog } from './health-shortcut-dialog';
import {
  healthShortcutPromptKind,
  openHealthShortcut,
  readHealthShortcutInstall,
  snoozeHealthShortcut,
  validHealthShortcutUrl,
  writeHealthShortcutInstall,
  type HealthShortcutInstall,
  type HealthShortcutPromptKind,
} from '../lib/health-shortcut-install';
interface HealthStatus {
  paired: boolean;
  lastSync?: string;
  installationUrl?: string;
  lastUploadAt?: string;
  lastReceivedCount?: number;
  limitPerKind?: number;
}
/** This bridge never launches on mount, resume, focus or a timer. Only a user action can launch. */
export function HealthSyncBridge({ enabled }: { enabled: boolean }) {
  const { user } = useAuth();
  const [message, setMessage] = useState('');
  const [shortcutPrompt, setShortcutPrompt] = useState<{
    kind: HealthShortcutPromptKind;
    url: string;
    userId: string;
  } | null>(null);
  const installation = useRef<{
    userId: string;
    state: HealthShortcutInstall;
  } | null>(null);
  const reminderAt = useRef<number | null>(null);
  const readInstallation = useCallback(() => {
    if (!user) return {};
    if (installation.current?.userId !== user.id)
      installation.current = {
        userId: user.id,
        state: readHealthShortcutInstall(user.id),
      };
    return installation.current.state;
  }, [user]);
  const saveInstallation = (state: HealthShortcutInstall) => {
    if (!user) return;
    installation.current = { userId: user.id, state };
    writeHealthShortcutInstall(user.id, state);
    reminderAt.current = state.remindAt ?? null;
  };
  const checkInstallation = useCallback(
    (status: HealthStatus, manual = false) => {
      if (!user || !validHealthShortcutUrl(status.installationUrl))
        return false;
      const state = readInstallation();
      reminderAt.current =
        state.snoozedUrl === status.installationUrl
          ? (state.remindAt ?? null)
          : null;
      const kind = healthShortcutPromptKind(
        status.installationUrl,
        state,
        Date.now(),
        manual,
      );
      if (!kind) return false;
      const url = status.installationUrl;
      setShortcutPrompt((current) =>
        current?.url === url &&
        current.userId === user.id &&
        current.kind === kind
          ? current
          : { kind, url, userId: user.id },
      );
      return true;
    },
    [user, readInstallation],
  );
  const running = useRef(false);
  const preparedLaunch = useRef<{
    url: string;
    installationUrl: string;
    expiresAt: number;
  } | null>(null);
  const pollUntil = useRef(0);
  const previousReceipt = useRef<string | undefined>(undefined);
  const launch = useCallback(async () => {
    if (
      !enabled ||
      !user ||
      running.current ||
      document.visibilityState !== 'visible'
    )
      return;
    // Keep retries inside the tap gesture when iOS blocks an asynchronous first launch.
    if (
      preparedLaunch.current &&
      preparedLaunch.current.expiresAt > Date.now()
    ) {
      if (
        checkInstallation(
          {
            paired: true,
            installationUrl: preparedLaunch.current.installationUrl,
          },
          true,
        )
      )
        return;
      pollUntil.current = Date.now() + 15 * 60000;
      openHealthShortcut(preparedLaunch.current.url);
      return;
    }
    running.current = true;
    try {
      const status = await api.get<HealthStatus>('/nutrition/health');
      previousReceipt.current = status.lastUploadAt ?? status.lastSync;
      if (!validHealthShortcutUrl(status.installationUrl)) {
        setMessage(
          'The Health Shortcut installation link is not available yet.',
        );
        return;
      }
      if (checkInstallation(status, true)) return;
      if (!status.paired) {
        await api.post('/nutrition/health/pair');
        await revalidate('/nutrition/health');
      }
      const key = `lp.health.attempt.v1.${user.id}`;
      if (Date.now() - Number(sessionStorage.getItem(key) ?? 0) < 15000) {
        setMessage('Please wait a few seconds before retrying.');
        return;
      }
      sessionStorage.setItem(key, String(Date.now()));
      const ticket = await api.post<{
        token: string;
        limitPerKind: number;
      }>('/nutrition/health/launch');
      if (!Number.isInteger(ticket.limitPerKind) || ticket.limitPerKind < 1)
        throw new Error(
          'The Health sync update is still deploying. Please retry shortly.',
        );
      const url = healthShortcutUrl({
        token: ticket.token,
        limitPerKind: ticket.limitPerKind,
        uploadUrl: new URL(
          `${API_URL}/nutrition/health/upload`,
          window.location.origin,
        ).href,
      });
      preparedLaunch.current = {
        url,
        installationUrl: status.installationUrl,
        expiresAt: Date.now() + 14 * 60000,
      };
      pollUntil.current = Date.now() + 15 * 60000;
      setMessage(
        'Sync started. Return to this app when Shortcuts finishes. Tap Sync again if your browser blocked opening Shortcuts.',
      );
      openHealthShortcut(url);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Health sync could not start.',
      );
    } finally {
      running.current = false;
    }
  }, [enabled, user, checkInstallation]);
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    const refresh = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const status = await api.get<HealthStatus>('/nutrition/health');
        await revalidate('/nutrition/health');
        if (!disposed && /iPhone|iPad|iPod/i.test(navigator.userAgent))
          checkInstallation(status);
        const receipt = status.lastUploadAt ?? status.lastSync;
        if (
          !status.paired ||
          receipt !== previousReceipt.current ||
          (preparedLaunch.current &&
            preparedLaunch.current.installationUrl !== status.installationUrl)
        ) {
          preparedLaunch.current = null;
          previousReceipt.current = receipt;
          if (!disposed) setMessage('');
        }
        if (Date.now() < pollUntil.current) {
          void revalidate('/nutrition');
          void revalidate('/dashboard');
        }
      } catch {
        /* A later manual retry surfaces errors; background refresh never opens Shortcuts. */
      }
    };
    const manual = () => {
      void launch();
    };
    const resume = () => {
      void refresh();
    };
    const install = (event: Event) => {
      const url = (event as CustomEvent<string>).detail;
      if (!user || !validHealthShortcutUrl(url)) return;
      const state = readInstallation();
      setShortcutPrompt({
        url,
        userId: user.id,
        kind:
          state.installedUrl && state.installedUrl !== url
            ? 'update'
            : 'install',
      });
    };
    const storage = () => {
      installation.current = null;
      void refresh();
    };
    void refresh();
    window.addEventListener('lp-health-install', install);
    window.addEventListener('storage', storage);
    window.addEventListener('lp-health-sync', manual);
    window.addEventListener('focus', resume);
    document.addEventListener('visibilitychange', resume);
    const timer = window.setInterval(() => {
      if (
        Date.now() < pollUntil.current ||
        (reminderAt.current !== null && Date.now() >= reminderAt.current)
      ) {
        reminderAt.current = null;
        void refresh();
      }
    }, 15000);
    return () => {
      disposed = true;
      clearInterval(timer);
      window.removeEventListener('lp-health-install', install);
      window.removeEventListener('storage', storage);
      window.removeEventListener('lp-health-sync', manual);
      window.removeEventListener('focus', resume);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [enabled, launch, user, checkInstallation, readInstallation]);
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('lp-health-status', { detail: message }),
    );
  }, [message]);
  const activePrompt =
    enabled && shortcutPrompt?.userId === user?.id ? shortcutPrompt : null;
  return (
    <>
      {activePrompt && (
        <HealthShortcutDialog
          key={`${activePrompt.userId}:${activePrompt.url}`}
          kind={activePrompt.kind}
          onInstall={() => {
            saveInstallation({
              ...readInstallation(),
              pendingUrl: activePrompt.url,
            });
            setShortcutPrompt({ ...activePrompt, kind: 'confirm' });
            openHealthShortcut(activePrompt.url);
          }}
          onConfirm={() => {
            saveInstallation({ installedUrl: activePrompt.url });
            preparedLaunch.current = null;
            setShortcutPrompt(null);
            void launch();
          }}
          onLater={() => {
            saveInstallation(
              snoozeHealthShortcut(
                activePrompt.url,
                readInstallation(),
                Date.now(),
              ),
            );
            setShortcutPrompt(null);
          }}
          onDecline={() => {
            saveInstallation({
              ...readInstallation(),
              pendingUrl: undefined,
              declinedUrl: activePrompt.url,
              snoozedUrl: undefined,
              remindAt: undefined,
            });
            setShortcutPrompt(null);
          }}
        />
      )}
      {message && (
        <div
          role="status"
          className="fixed bottom-24 left-1/2 z-[60] flex w-[calc(100%_-_2rem)] max-w-md -translate-x-1/2 items-start gap-3 rounded-xl border border-border bg-surface p-3 text-xs text-ink shadow-xl"
        >
          <p className="flex-1">{message}</p>
          <button
            type="button"
            aria-label="Dismiss sync message"
            className="shrink-0 px-2 py-1 text-ink-muted"
            onClick={() => setMessage('')}
          >
            ✕
          </button>
        </div>
      )}
    </>
  );
}

export function HealthSyncButton() {
  const status = useApi<HealthStatus>('/nutrition/health', {
    revalidateOnFocus: true,
    refreshInterval: 60000,
  });
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  const due = status.data?.paired && healthSyncDue(status.data.lastSync, now);
  return (
    <button
      type="button"
      className={`flex h-10 items-center gap-1 rounded-lg px-2 text-xs font-medium hover:bg-violet-500/10 ${due ? 'text-amber-400' : 'text-violet-400'}`}
      aria-label={
        due
          ? 'Sync Apple Health — last sync missing or more than six hours ago'
          : 'Sync Apple Health'
      }
      title={
        due
          ? 'Sync recommended: six hours since the last successful sync, or no sync received yet'
          : 'Sync Apple Health'
      }
      onClick={() => window.dispatchEvent(new Event('lp-health-sync'))}
    >
      <RefreshCw size={15} /> {due ? 'Sync due' : 'Sync'}
    </button>
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
  const [syncMessage, setSyncMessage] = useState('');
  useEffect(() => {
    const receive = (event: Event) =>
      setSyncMessage((event as CustomEvent<string>).detail);
    window.addEventListener('lp-health-status', receive);
    return () => window.removeEventListener('lp-health-status', receive);
  }, []);
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
              onClick={(event) => {
                event.preventDefault();
                window.dispatchEvent(
                  new CustomEvent('lp-health-install', {
                    detail: status.data?.installationUrl,
                  }),
                );
              }}
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
          3. Return here and wait for “Last data received.” Missing permission
          or no samples does not establish inactivity.
        </p>
        <p className="text-xs text-ink-muted">
          The Shortcut requires an iPhone installation and export check. If
          installation or permissions fail, skip this step and retry here later.
          Sync opens Shortcuts only when you tap it. A reminder appears after
          six hours. When finished, return to your existing Life Portal app; we
          do not open a browser return link.
        </p>
        {status.error && (
          <ErrorNote message={(status.error as Error).message} />
        )}
        {error && <ErrorNote message={error} />}
        {syncMessage && (
          <p role="status" className="text-xs text-ink-muted">
            {syncMessage}
          </p>
        )}
        <p role="status" className="font-medium">
          {status.data?.lastSync
            ? `Last data received · ${new Date(status.data.lastSync).toLocaleString()}`
            : status.data?.paired
              ? 'Paired — waiting for Health samples'
              : 'Not connected'}
        </p>
        <p className="text-xs text-ink-muted">
          Imports up to {status.data?.limitPerKind ?? 50} recent samples each
          for Steps and Active Energy. Earlier imports are kept. A sync may not
          include all activity since the previous upload.
        </p>
        {status.data?.lastUploadAt && (
          <p role="status" className="text-xs text-ink-muted">
            Last upload · {new Date(status.data.lastUploadAt).toLocaleString()}{' '}
            · {status.data.lastReceivedCount ?? 0} samples received
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
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
              type="button"
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
