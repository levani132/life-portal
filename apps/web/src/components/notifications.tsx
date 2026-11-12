'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Bell, Share, SquarePlus } from 'lucide-react';
import type {
  ActivityItem,
  ActivityPage,
  NotificationPreferences,
  NotificationType,
  NotificationsConfig,
  PortalState,
  PushDeviceSummary,
} from '@life-portal/shared-types';
import { api, ApiError } from '../lib/api';
import { useApi } from '../lib/hooks';
import {
  enablePush,
  permission,
  pushSupport,
  resyncSubscription,
  setBadge,
  thisDeviceId,
  type PushSupport,
} from '../lib/push';
import { badgeEarnedText } from '@life-portal/shared-domain';
import { postTimeLabel } from '../lib/post-time';
import { EmptyState, ErrorNote, Modal, Panel, Spinner } from './ui';

const OFFER_EVENT = 'lp:notification-offer';
const UNSEEN_KEY = '/notifications/activity/unseen';

/**
 * Asks the app shell to offer notifications, after an action that makes them useful (a friend
 * request, a first post, a comment). It shows only if notifications are available, not yet on,
 * and the member has not dismissed the offer in the last 14 days.
 */
export function requestNotificationOffer(reason: 'friend' | 'post' | 'comment') {
  window.dispatchEvent(new CustomEvent(OFFER_EVENT, { detail: reason }));
}

function pushAccess(access: PortalState['access'] | undefined): boolean {
  return !!access?.push && !!access.social;
}

/** Client-only: the browser's capabilities are unknown during server rendering. */
function useSupport(): { support: PushSupport; granted: boolean } | null {
  const [state, setState] = useState<{
    support: PushSupport;
    granted: boolean;
  } | null>(null);
  useEffect(() => {
    setState({ support: pushSupport(), granted: permission() === 'granted' });
  }, []);
  return state;
}

/**
 * Mounted once by the app shell: keeps this device's subscription current, keeps the icon
 * badge in step with Activity, and shows the offer when another component asks for it.
 */
export function NotificationsBridge({ access }: { access: PortalState['access'] }) {
  const enabled = pushAccess(access);
  const config = useApi<NotificationsConfig>(enabled ? '/notifications/config' : null);
  const available = !!config.data?.available;
  const unseen = useApi<{ count: number }>(available ? UNSEEN_KEY : null, {
    revalidateOnFocus: true,
    refreshInterval: 60000,
  });
  const publicKey = config.data?.publicKey;

  useEffect(() => {
    if (publicKey) void resyncSubscription(publicKey).catch(() => undefined);
  }, [publicKey]);
  useEffect(() => {
    if (unseen.data) setBadge(unseen.data.count);
  }, [unseen.data]);

  return available ? <NotificationOffer /> : null;
}

function NotificationOffer() {
  const [open, setOpen] = useState(false);
  const prefs = useApi<NotificationPreferences>('/notifications/preferences');
  const support = useSupport();

  useEffect(() => {
    const onOffer = () => {
      const data = prefs.data;
      if (!data || !support || support.support === 'unsupported') return;
      if (data.offerHiddenUntil && Date.parse(data.offerHiddenUntil) > Date.now()) return;
      if (data.enabled && support.granted) return;
      if (permission() === 'denied') return;
      setOpen(true);
    };
    window.addEventListener(OFFER_EVENT, onOffer);
    return () => window.removeEventListener(OFFER_EVENT, onOffer);
  }, [prefs.data, support]);

  const dismiss = useCallback(() => {
    setOpen(false);
    void api
      .post<NotificationPreferences>('/notifications/offer/dismiss')
      .then((next) => prefs.mutate(next, { revalidate: false }))
      .catch(() => undefined);
  }, [prefs]);

  if (!open || !support) return null;
  return (
    <Modal open title="Get notified" onClose={dismiss}>
      {support.support === 'ios-tab' ? (
        <AddToHomeScreen />
      ) : (
        <EnableButton
          onDone={() => {
            setOpen(false);
            void prefs.mutate();
          }}
        />
      )}
    </Modal>
  );
}

function AddToHomeScreen() {
  return (
    <div className="space-y-3 text-sm">
      <p>
        On iPhone, notifications only work from the Life Portal app on your Home Screen.
      </p>
      <ol className="space-y-2 text-ink-muted">
        <li className="flex items-center gap-2">
          <span>1.</span> Tap <Share size={16} aria-label="Share" /> in Safari’s toolbar.
        </li>
        <li className="flex items-center gap-2">
          <span>2.</span> Choose <SquarePlus size={16} aria-hidden /> Add to Home Screen.
        </li>
        <li>3. Open Life Portal from your Home Screen and turn notifications on there.</li>
      </ol>
    </div>
  );
}

/** The only place the permission prompt can appear, and only from this button's tap. */
function EnableButton({ onDone }: { onDone: () => void }) {
  const [state, setState] = useState<'idle' | 'pending' | 'denied' | 'error'>('idle');
  return (
    <div className="space-y-3 text-sm">
      <p>
        Hear about friend requests, comments and likes on your posts. Notifications show
        names and what happened — never your food, weight or money.
      </p>
      {state === 'denied' && <BlockedHelp />}
      {state === 'error' && (
        <ErrorNote message="Notifications could not be turned on. Try again in a moment." />
      )}
      <button
        type="button"
        className="btn-primary w-full justify-center"
        disabled={state === 'pending'}
        onClick={() => {
          setState('pending');
          enablePush()
            .then((result) => {
              if (result === 'granted') onDone();
              else setState(result === 'denied' ? 'denied' : 'idle');
            })
            .catch(() => setState('error'));
        }}
      >
        <Bell size={16} aria-hidden />
        {state === 'pending' ? 'Turning on…' : 'Turn on notifications'}
      </button>
    </div>
  );
}

function BlockedHelp() {
  return (
    <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
      Notifications are blocked for Life Portal on this device. Allow them in your device’s
      settings (on iPhone: Settings › Notifications › Life Portal), then come back here.
    </p>
  );
}

/** Header bell with the unseen Activity count. */
export function ActivityBell({ access }: { access: PortalState['access'] }) {
  const config = useApi<NotificationsConfig>(
    pushAccess(access) ? '/notifications/config' : null,
  );
  const unseen = useApi<{ count: number }>(config.data?.available ? UNSEEN_KEY : null, {
    revalidateOnFocus: true,
    refreshInterval: 60000,
  });
  if (!config.data?.available) return null;
  const count = unseen.data?.count ?? 0;
  return (
    <Link
      href="/activity"
      className="relative inline-flex h-9 w-9 items-center justify-center rounded-full text-ink-muted hover:text-ink"
      aria-label={count ? `Activity, ${count} new` : 'Activity'}
    >
      <Bell size={20} aria-hidden />
      {count > 0 && (
        <span className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-sky-500 px-1 text-center text-[10px] font-semibold leading-[18px] text-white">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  );
}

// ------------------------------------------------------------------ Settings

const TYPE_LABELS: { type: NotificationType; label: string; hint: string }[] = [
  {
    type: 'friendRequest',
    label: 'Friend requests',
    hint: 'Someone wants to connect',
  },
  {
    type: 'friendAccepted',
    label: 'Accepted requests',
    hint: 'Someone accepted your request',
  },
  { type: 'postComment', label: 'Comments', hint: 'On your posts' },
  {
    type: 'postLike',
    label: 'Likes',
    hint: 'On your posts, grouped so bursts stay quiet',
  },
  {
    type: 'postRepost',
    label: 'Reposts',
    hint: 'Someone put your post on their wall',
  },
  {
    type: 'message',
    label: 'Messages',
    hint: 'From friends, unless you muted that conversation',
  },
  { type: 'badgeEarned', label: 'Badges', hint: 'When you earn a new badge' },
];

function Toggle({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 rounded-xl border border-border p-4">
      <input
        type="checkbox"
        className="mt-1 h-5 w-5 shrink-0 accent-sky-400"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        <span className="block font-medium">{label}</span>
        {hint && <span className="mt-1 block text-xs text-ink-muted">{hint}</span>}
      </span>
    </label>
  );
}

export function NotificationSettings() {
  const config = useApi<NotificationsConfig>('/notifications/config');
  const portal = useApi<PortalState>('/portal');
  const messaging = !!portal.data?.access.messages;
  const available = !!config.data?.available;
  const prefs = useApi<NotificationPreferences>(available ? '/notifications/preferences' : null);
  const devices = useApi<PushDeviceSummary[]>(available ? '/notifications/devices' : null);
  const support = useSupport();
  const [error, setError] = useState<string | null>(null);

  if (config.isLoading || (available && prefs.isLoading) || !support) return <Spinner />;
  if (!available)
    return <EmptyState message="Notifications aren’t available for your account yet." />;
  if (prefs.error || !prefs.data)
    return <ErrorNote message="Your notification settings could not be loaded." />;
  const data = prefs.data;
  const update = async (patch: Partial<NotificationPreferences>) => {
    setError(null);
    try {
      await prefs.mutate(
        await api.put<NotificationPreferences>('/notifications/preferences', patch),
        { revalidate: false },
      );
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not save.');
    }
  };
  const blocked = permission() === 'denied';
  const thisDevice = thisDeviceId();
  const onThisDevice = !!devices.data?.some((d) => d.id === thisDevice) && support.granted;

  return (
    <div className="space-y-4">
      {error && <ErrorNote message={error} />}
      <Panel title="This device">
        {support.support === 'ios-tab' ? (
          <AddToHomeScreen />
        ) : support.support === 'unsupported' ? (
          <p className="text-sm text-ink-muted">
            This browser can’t receive notifications. Try Chrome, Edge, Firefox or Safari, or
            the Life Portal app on your Home Screen.
          </p>
        ) : blocked ? (
          <BlockedHelp />
        ) : onThisDevice ? (
          <p className="text-sm text-ink-muted">This device receives your notifications.</p>
        ) : (
          <EnableButton
            onDone={() => {
              void prefs.mutate();
              void devices.mutate();
            }}
          />
        )}
      </Panel>

      <Panel title="What to notify me about">
        <div className="space-y-3">
          <Toggle
            label="Notifications"
            hint="Turn off to pause everything. Your choices below are kept."
            checked={data.enabled}
            onChange={(enabled) => void update({ enabled })}
          />
          {TYPE_LABELS.filter(({ type }) => type !== 'message' || messaging).map(({ type, label, hint }) => (
            <Toggle
              key={type}
              label={label}
              hint={hint}
              checked={data.types[type]}
              disabled={!data.enabled}
              onChange={(value) =>
                void update({ types: { [type]: value } as NotificationPreferences['types'] })
              }
            />
          ))}
          <Toggle
            label="Show comment previews"
            hint="Adds the start of a comment to the notification. It can appear on your lock screen."
            checked={data.showCommentPreviews}
            disabled={!data.enabled}
            onChange={(showCommentPreviews) => void update({ showCommentPreviews })}
          />
          {messaging && (
            <Toggle
              label="Show message previews"
              hint="Adds the start of a message to the notification. It can appear on your lock screen."
              checked={data.showMessagePreviews}
              disabled={!data.enabled}
              onChange={(showMessagePreviews) => void update({ showMessagePreviews })}
            />
          )}
        </div>
      </Panel>

      <Panel title="Devices" description="Each signed-in device you turned notifications on for.">
        {!devices.data?.length ? (
          <p className="text-sm text-ink-muted">No devices yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {devices.data.map((device) => (
              <li key={device.id} className="flex items-center justify-between gap-3 py-3">
                <span className="min-w-0">
                  <span className="block truncate font-medium">
                    {device.label}
                    {device.id === thisDevice && (
                      <span className="ml-2 text-xs text-ink-faint">This device</span>
                    )}
                  </span>
                  <span className="text-xs text-ink-faint">
                    Added{' '}
                    {new Date(device.createdAt).toLocaleDateString(undefined, {
                      day: 'numeric',
                      month: 'short',
                    })}
                  </span>
                </span>
                <button
                  type="button"
                  className="btn-ghost shrink-0"
                  onClick={() =>
                    void api
                      .delete(`/notifications/devices/${device.id}`)
                      .then(() => devices.mutate())
                      .catch(() => setError('Could not remove that device.'))
                  }
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

// ------------------------------------------------------------------ Activity

function activityText(item: ActivityItem): string {
  const names = item.actors.map((a) => a.displayName);
  const who =
    item.othersCount > 0
      ? `${names.join(', ')} and ${item.othersCount} other${item.othersCount === 1 ? '' : 's'}`
      : names.length > 1
        ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
        : (names[0] ?? 'Someone');
  const post = item.postTitle ? `“${item.postTitle}”` : 'your post';
  switch (item.type) {
    case 'friendRequest':
      return `${who} sent you a friend request`;
    case 'friendAccepted':
      return `${who} accepted your friend request`;
    case 'postComment':
      return `${who} commented on ${post}`;
    case 'postLike':
      return `${who} liked ${post}`;
    case 'postRepost':
      return `${who} reposted ${post}`;
    case 'message':
      return `${who} sent you a message`;
    case 'badgeEarned':
      return badgeEarnedText(item.badgeId ?? '', item.badgeTier).body;
  }
}

export function ActivityList() {
  const [pages, setPages] = useState<ActivityPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const first = useApi<ActivityPage>('/notifications/activity');
  const unseen = useApi<{ count: number }>(UNSEEN_KEY);

  // Opening Activity marks everything seen and clears the badge (US5).
  useEffect(() => {
    if (!first.data) return;
    setPages([first.data]);
    setLoading(false);
    void api
      .post<{ count: number }>('/notifications/activity/seen')
      .then((next) => {
        setBadge(next.count);
        void unseen.mutate(next, { revalidate: false });
      })
      .catch(() => undefined);
    // Runs once per loaded first page; `unseen.mutate` is stable.
  }, [first.data]);

  if (first.error) return <ErrorNote message="Activity could not be loaded." />;
  if (loading) return <Spinner />;
  const items = pages.flatMap((page, index) =>
    page.items.map((item) => ({ item, key: `${index}:${item.id}` })),
  );
  const next = pages[pages.length - 1]?.nextBefore;
  if (!items.length)
    return <EmptyState message="Nothing yet. Friend requests, comments and likes show up here." />;
  return (
    <div className="space-y-2">
      {error && <ErrorNote message={error} />}
      <ul className="card divide-y divide-border">
        {items.map(({ item, key }) => (
          <li key={key}>
            <Link
              href={item.url}
              className="flex items-start gap-3 px-5 py-4 hover:bg-surface-raised"
            >
              <span
                className={
                  item.unseen
                    ? 'mt-2 h-2 w-2 shrink-0 rounded-full bg-sky-500'
                    : 'mt-2 h-2 w-2 shrink-0'
                }
                aria-label={item.unseen ? 'New' : undefined}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm">{activityText(item)}</span>
                <span className="text-xs text-ink-faint">{postTimeLabel(item.createdAt)}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {next && (
        <button
          type="button"
          className="btn-ghost w-full justify-center"
          onClick={() =>
            void api
              .get<ActivityPage>(`/notifications/activity?before=${encodeURIComponent(next)}`)
              .then((page) => setPages((current) => [...current, page]))
              .catch(() => setError('Older activity could not be loaded.'))
          }
        >
          Older activity
        </button>
      )}
    </div>
  );
}
