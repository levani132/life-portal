'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, RefreshCw, XCircle } from 'lucide-react';
import type { ActivityAdjustment } from '@life-portal/shared-types';
import { api, API_URL } from '../lib/api';
import { revalidate, useApi } from '../lib/hooks';
import { useAuth } from '../lib/auth-context';
import { useIsIOS } from '../lib/ios-device';
import { healthShortcutUrl, healthTokenState } from '../lib/health-sync';
import { ErrorNote, Panel } from './ui';
import { HealthActivityChart } from './health-activity-chart';
import { HealthShortcutDialog } from './health-shortcut-dialog';
import {
  healthShortcutPromptKind,
  healthShortcutInstallStatus,
  HEALTH_SHORTCUT_INSTALL_EVENT,
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
  lastManualLaunch?: string;
  tokenExpiresAt?: string;
  installationUrl?: string;
  lastUploadAt?: string;
  lastReceivedCount?: number;
  limitPerKind?: number;
}
/** This bridge never launches on mount, resume, focus or a timer. Only a user action can launch. */
export function HealthSyncBridge({ enabled }: { enabled: boolean }) {
  const ios = useIsIOS();
  return ios && enabled ? <IOSHealthSyncBridge enabled /> : null;
}
function IOSHealthSyncBridge({ enabled }: { enabled: boolean }) {
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
  const ios = useIsIOS();
  return ios ? <IOSHealthSyncButton /> : null;
}
function IOSHealthSyncButton() {
  const status = useApi<HealthStatus>('/nutrition/health', {
    revalidateOnFocus: true,
    refreshInterval: 60000,
  });
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  const due =
    status.data?.paired &&
    healthTokenState(
      status.data.lastManualLaunch,
      status.data.tokenExpiresAt,
      now,
    ) !== 'active';
  return (
    <button
      type="button"
      className={`flex h-10 items-center gap-1 rounded-lg px-2 text-xs font-medium hover:bg-violet-500/10 ${due ? 'text-amber-400' : 'text-violet-400'}`}
      aria-label={
        due
          ? 'Renew automatic Apple Health sync — run manually every 20 days'
          : 'Sync Apple Health'
      }
      title={
        due
          ? 'Tap Sync to renew the 30-day automatic sync connection'
          : 'Sync Apple Health'
      }
      onClick={() => window.dispatchEvent(new Event('lp-health-sync'))}
    >
      <RefreshCw size={15} /> {due ? 'Renew sync' : 'Sync'}
    </button>
  );
}
export function AppleHealthPanel({
  activity,
  setupGuide = false,
}: {
  activity?: ActivityAdjustment;
  setupGuide?: boolean;
}) {
  const ios = useIsIOS();
  return ios ? (
    <IOSAppleHealthPanel activity={activity} setupGuide={setupGuide} />
  ) : null;
}

export function HealthConnectionSettings() {
  const ios = useIsIOS();
  if (ios === null) return null;
  return ios ? (
    <AppleHealthPanel setupGuide />
  ) : (
    <Panel title="Apple Health & Shortcuts">
      <p className="text-sm text-ink-muted">
        Health syncing works only on iOS. Open Life Portal on your iPhone or
        iPad to install the Shortcut, connect Apple Health and set up scheduled
        syncing. Desktop and Android cannot collect Apple Health samples.
      </p>
    </Panel>
  );
}

function IOSAppleHealthPanel({
  activity,
  setupGuide,
}: {
  activity?: ActivityAdjustment;
  setupGuide: boolean;
}) {
  const status = useApi<HealthStatus>('/nutrition/health', {
    revalidateOnFocus: true,
    refreshInterval: 15000,
  });
  const { user } = useAuth();
  const [installation, setInstallation] = useState<HealthShortcutInstall>({});
  useEffect(() => {
    const refresh = (event?: Event) => {
      const update = (
        event as
          | CustomEvent<{ userId: string; state: HealthShortcutInstall }>
          | undefined
      )?.detail;
      setInstallation(
        user
          ? update?.userId === user.id
            ? update.state
            : readHealthShortcutInstall(user.id)
          : {},
      );
    };
    refresh();
    window.addEventListener(HEALTH_SHORTCUT_INSTALL_EVENT, refresh);
    window.addEventListener('storage', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener(HEALTH_SHORTCUT_INSTALL_EVENT, refresh);
      window.removeEventListener('storage', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [user]);
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
  const installState = healthShortcutInstallStatus(
    status.data?.installationUrl,
    installation,
  );
  const InstallIcon =
    installState === 'installed'
      ? CheckCircle2
      : installState === 'update'
        ? AlertTriangle
        : XCircle;
  const installLabel =
    installState === 'installed'
      ? 'Installed · confirmed on this device'
      : installState === 'update'
        ? 'Update available'
        : installState === 'missing'
          ? 'Not installed on this device'
          : 'Setup link unavailable';
  return (
    <Panel title="Apple Health">
      <div className="space-y-4 text-sm">
        {setupGuide && (
          <div className="space-y-2 text-xs text-ink-muted">
            <p className="font-medium text-ink">Set up Health syncing</p>
            <ol className="list-decimal space-y-1 pl-4">
              <li>Install Life Portal Health and keep its name unchanged.</li>
              <li>
                Tap Sync here once to save your connection and allow Health
                access.
              </li>
              <li>
                For automatic syncing, open the Shortcut in Shortcuts and enable
                its scheduled runs. Allow running when locked if offered.
              </li>
            </ol>
            <p>
              Installing the Shortcut does not enable its schedule. You can
              always sync manually.
            </p>
            <p>
              Scheduled runs reuse your saved connection for 30 days. Tap Sync
              manually every 20 days to renew it. The latest 50 samples per type
              may not cover the whole day.
            </p>
          </div>
        )}
        <button
          type="button"
          disabled={!status.data?.installationUrl}
          className="flex w-full items-center gap-3 rounded-xl border border-border p-3 text-left disabled:opacity-60"
          onClick={() =>
            window.dispatchEvent(
              new CustomEvent('lp-health-install', {
                detail: status.data?.installationUrl,
              }),
            )
          }
        >
          <InstallIcon
            aria-hidden="true"
            size={22}
            className={
              installState === 'installed'
                ? 'text-emerald-400'
                : installState === 'update'
                  ? 'text-amber-400'
                  : 'text-rose-400'
            }
          />
          <span className="flex-1">
            <span className="block font-medium">Life Portal Health</span>
            <span className="text-xs text-ink-muted">{installLabel}</span>
          </span>
          <span className="text-xs text-accent">
            {installState === 'installed'
              ? 'Manage'
              : installState === 'update'
                ? 'Update'
                : 'Install'}
          </span>
        </button>
        {installState === 'missing' && (
          <p className="text-xs text-ink-muted">
            Install the Shortcut, allow Health access, then return here to sync.
          </p>
        )}
        {status.error && (
          <ErrorNote message={(status.error as Error).message} />
        )}
        {error && <ErrorNote message={error} />}
        {syncMessage && (
          <p role="status" className="text-xs text-ink-muted">
            {syncMessage}
          </p>
        )}
        {activity && (
          <>
            <dl className="grid grid-cols-3 gap-2">
              {[
                ['Active kcal', activity.recordedActiveKcal.toLocaleString()],
                ['Steps', activity.steps.toLocaleString()],
                ['Adjustment', `+${activity.adjustmentKcal} kcal`],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl bg-violet-500/10 p-3">
                  <dt className="text-[11px] text-ink-muted">{label}</dt>
                  <dd className="mt-1 font-semibold tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
            <HealthActivityChart activity={activity} />
          </>
        )}
        <div className="flex items-center justify-between gap-3">
          <p role="status" className="text-xs text-ink-muted">
            {status.data?.lastSync
              ? `Last data · ${new Date(status.data.lastSync).toLocaleString()}`
              : 'No Health data received yet'}
          </p>
          <button
            type="button"
            disabled={busy || !status.data?.installationUrl}
            className="btn-primary shrink-0"
            onClick={() =>
              status.data?.paired
                ? window.dispatchEvent(new Event('lp-health-sync'))
                : void pair()
            }
          >
            {busy ? 'Connecting…' : 'Sync'}
          </button>
        </div>
        {status.data?.paired && (
          <div className="space-y-1 text-xs text-ink-muted">
            {!setupGuide && (
              <p>
                With Shortcut automations enabled, Health sync runs on your
                schedule. Tap Sync manually every 20 days to renew its 30-day
                connection.
              </p>
            )}
            {healthTokenState(
              status.data.lastManualLaunch,
              status.data.tokenExpiresAt,
              Date.now(),
            ) !== 'active' && (
              <p role="status" className="text-amber-400">
                Tap Sync now to renew automatic syncing.
              </p>
            )}
          </div>
        )}
        <details className="rounded-xl border border-border p-3">
          <summary className="cursor-pointer text-xs text-ink-muted">
            Details & connection
          </summary>
          <div className="mt-3 space-y-3 text-xs text-ink-muted">
            <p>
              Each sync imports up to {status.data?.limitPerKind ?? 50} recent
              samples per type. Gaps keep your activity estimate; syncing may
              not capture the full day.
            </p>
            {activity && (
              <p>
                Starting target {activity.startingTargetKcal} kcal → current
                target {activity.currentTargetKcal} kcal. The adjustment is
                already included.
              </p>
            )}
            {status.data?.tokenExpiresAt && (
              <p>
                Automatic sync authorized until{' '}
                {new Date(status.data.tokenExpiresAt).toLocaleString()}.
              </p>
            )}
            {status.data?.lastUploadAt && (
              <p>
                Last upload ·{' '}
                {new Date(status.data.lastUploadAt).toLocaleString()} ·{' '}
                {status.data.lastReceivedCount ?? 0} samples received
              </p>
            )}
            {status.data?.paired && (
              <button
                type="button"
                className="text-rose-400 underline"
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
                      e instanceof Error ? e.message : 'Could not disconnect.',
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Disconnect & delete imports
              </button>
            )}
          </div>
        </details>
      </div>
    </Panel>
  );
}
