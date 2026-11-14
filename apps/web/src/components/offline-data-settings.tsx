'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../lib/auth-context';
import { deleteOfflineData, offlineCache, offlineDurable, outbox, startOffline, useOfflineAccount, useOutbox } from '../lib/offline/runtime';
import { PendingLogout } from './pending-logout';
import { Panel } from './ui';

interface StorageFacts {
  cached: number;
  usage?: number;
  quota?: number;
  persisted?: boolean;
}

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;

/**
 * Settings → "Offline data on this device" (spec 027, issue #16). What is kept, how much room it
 * takes, whether the browser promised to keep it, what that storage does and does not protect,
 * and a way to delete it. Pending writes are never deleted without the same explicit question
 * signing out asks.
 */
export function OfflineDataSettings() {
  const { user } = useAuth();
  const account = useOfflineAccount();
  const snapshot = useOutbox();
  const [facts, setFacts] = useState<StorageFacts | null>(null);
  const [asking, setAsking] = useState<'pending' | 'confirm' | null>(null);
  const [cleared, setCleared] = useState(false);

  const measure = useCallback(async () => {
    const cached = (await offlineCache()?.count().catch(() => 0)) ?? 0;
    const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined;
    const estimate = await storage?.estimate?.().catch(() => undefined);
    const persisted = await storage?.persisted?.().catch(() => undefined);
    setFacts({ cached, usage: estimate?.usage, quota: estimate?.quota, persisted });
  }, []);

  useEffect(() => {
    void measure();
  }, [measure, account, snapshot.items.length]);

  const clear = useCallback(async () => {
    if (!user) return;
    setAsking(null);
    await deleteOfflineData(user.id);
    await startOffline(user.id);
    setCleared(true);
    await measure();
  }, [user, measure]);

  const pending = snapshot.items.length;
  return (
    <Panel
      title="Offline data on this device"
      description="Training, food and social screens keep what they need here so they work without a connection."
    >
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <dt className="text-ink-muted">Changes waiting to send</dt>
        <dd className="text-right">{pending}</dd>
        <dt className="text-ink-muted">Saved screens</dt>
        <dd className="text-right">{facts?.cached ?? '…'}</dd>
        {facts?.usage !== undefined && (
          <>
            <dt className="text-ink-muted">Storage used by this site</dt>
            <dd className="text-right">
              {mb(facts.usage)}
              {facts.quota ? ` of ${mb(facts.quota)}` : ''}
            </dd>
          </>
        )}
        <dt className="text-ink-muted">Kept by the browser</dt>
        <dd className="text-right">
          {!offlineDurable() ? 'Not available here' : facts?.persisted ? 'Yes' : 'Best effort'}
        </dd>
      </dl>
      <div className="mt-4 space-y-2 text-xs text-ink-faint">
        <p>
          This storage is not encrypted by the app: anyone who can use this browser profile can read it. Money,
          banking, investments and work are never stored here; they always load from the server.
        </p>
        <p>
          The browser may still clear it when space runs low, and Safari on iPhone and iPad can delete a site’s data
          after a few weeks without use. Changes that have not been sent would be lost then, so open the app now and
          then while some are waiting. Saved screens you have not opened for 30 days are deleted.
        </p>
      </div>
      <div className="mt-4 flex items-center justify-end gap-3">
        {cleared && <span className="text-xs text-ink-faint">Offline data deleted.</span>}
        <button
          type="button"
          className="btn-danger"
          onClick={() => {
            setCleared(false);
            setAsking(outbox.count() > 0 ? 'pending' : 'confirm');
          }}
        >
          Clear offline data
        </button>
      </div>
      {asking === 'confirm' && (
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm">
          <span className="mr-auto">Delete everything this app keeps on this device for your account?</span>
          <button type="button" className="btn-ghost" onClick={() => setAsking(null)}>
            Cancel
          </button>
          <button type="button" className="btn-danger" onClick={() => void clear()}>
            Delete
          </button>
        </div>
      )}
      {asking === 'pending' && (
        <PendingLogout
          title="Unsent changes on this device"
          proceedLabel="Discard pending changes and clear"
          stayLabel="Keep offline data"
          onCancel={() => setAsking(null)}
          onSignOut={() => void clear()}
        />
      )}
    </Panel>
  );
}
