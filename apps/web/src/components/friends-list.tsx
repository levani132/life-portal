'use client';
import { GlassPill } from './glass-pill';
import { useState } from 'react';
import type { ConnectionList, PeoplePage } from '@life-portal/shared-types';
import { PersonCard, useSocialApi } from './social';
import { ErrorNote, Spinner } from './ui';
import { actingPageId } from '../lib/identity';
const LABELS: Record<ConnectionList, string> = {
  friends: 'Friends',
  incoming: 'Requests',
  outgoing: 'Sent',
  blocked: 'Blocked',
};
export function Friends() {
  // Spec 040: a page has followers, not friends; its one list here is who it blocked.
  const page = !!actingPageId();
  const [kind, setKind] = useState<ConnectionList>(page ? 'blocked' : 'friends');
  const [skip, setSkip] = useState(0);
  const result = useSocialApi<PeoplePage>(
    `/social/connections?kind=${kind}&skip=${skip}`,
  );
  return (
    <div className="mx-auto max-w-3xl">
      <div
        className="glass-tabs relative mb-5 flex gap-1 rounded-2xl border p-1"
        role="tablist"
        aria-label="Connections"
      >
        <GlassPill />
        {(Object.keys(LABELS) as ConnectionList[]).filter((value) => !page || value === 'blocked').map((value) => (
          <button
            type="button"
            key={value}
            role="tab"
            aria-selected={kind === value}
            className={`min-h-11 flex-1 rounded-xl border border-transparent px-2 text-sm ${kind === value ? 'glass-tab-on font-medium' : 'text-ink-muted'}`}
            onClick={() => {
              setKind(value);
              setSkip(0);
            }}
          >
            {LABELS[value]}
          </button>
        ))}
      </div>
      <div className="space-y-4">
        {result.error ? (
          <ErrorNote message={(result.error as Error).message} />
        ) : result.isLoading ? (
          <Spinner label="Loading connections…" />
        ) : (
          <>
            {result.data?.people.map((person) => (
              <PersonCard key={person.userId} person={person} />
            ))}
            {result.data?.people.length === 0 && (
              <div className="card p-6 text-sm text-ink-muted">
                {kind === 'friends'
                  ? 'Your people will appear here, along with up to two widgets they share with you.'
                  : kind === 'incoming'
                    ? 'No friend requests right now.'
                    : kind === 'outgoing'
                      ? 'No pending requests sent.'
                      : 'You haven’t blocked anyone.'}
              </div>
            )}
            <div className="flex justify-between">
              {skip > 0 && (
                <button
                  className="btn-ghost"
                  onClick={() => setSkip(Math.max(0, skip - 20))}
                >
                  Previous
                </button>
              )}
              {result.data?.hasMore && (
                <button
                  className="btn-ghost ml-auto"
                  onClick={() => setSkip(result.data!.nextSkip)}
                >
                  Next
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
