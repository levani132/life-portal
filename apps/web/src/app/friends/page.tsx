'use client';
import Link from 'next/link';
import { useState } from 'react';
import type { ConnectionList, PeoplePage } from '@life-portal/shared-types';
import { AppShell, PageHeader } from '../../components/app-shell';
import { PersonCard, useSocialApi } from '../../components/social';
import { ErrorNote, Spinner } from '../../components/ui';
const LABELS: Record<ConnectionList, string> = {
  friends: 'Friends',
  incoming: 'Requests',
  outgoing: 'Sent',
  blocked: 'Blocked',
};
export default function FriendsPage() {
  return (
    <AppShell>
      <Friends />
    </AppShell>
  );
}
function Friends() {
  const [kind, setKind] = useState<ConnectionList>('friends');
  const [skip, setSkip] = useState(0);
  const result = useSocialApi<PeoplePage>(
    `/social/connections?kind=${kind}&skip=${skip}`,
  );
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Friends"
        subtitle="A little window into the things your friends choose to share."
        actions={
          <Link href="/search" className="btn-primary">
            Find people
          </Link>
        }
      />
      <div
        className="mb-5 flex gap-1 rounded-xl border border-border p-1"
        role="tablist"
        aria-label="Connections"
      >
        {(Object.keys(LABELS) as ConnectionList[]).map((value) => (
          <button
            type="button"
            key={value}
            role="tab"
            aria-selected={kind === value}
            className={`min-h-11 flex-1 rounded-lg px-2 text-sm ${kind === value ? 'bg-surface-raised text-ink' : 'text-ink-muted'}`}
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
