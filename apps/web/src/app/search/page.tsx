'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { PeoplePage } from '@life-portal/shared-types';
import { AppShell, PageHeader } from '../../components/app-shell';
import { PersonCard, useSocialApi } from '../../components/social';
import { ErrorNote, Input, Spinner } from '../../components/ui';
export default function SearchPage() {
  return (
    <AppShell>
      <PeopleSearch />
    </AppShell>
  );
}
function PeopleSearch() {
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [skip, setSkip] = useState(0);
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(text.trim());
      setSkip(0);
    }, 350);
    return () => clearTimeout(timer);
  }, [text]);
  const result = useSocialApi<PeoplePage>(
    query.length >= 2
      ? `/social/search?q=${encodeURIComponent(query)}&skip=${skip}`
      : null,
  );
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Find your people"
        subtitle="Search by name or username."
        actions={
          <Link href="/profile" className="btn-ghost">
            My profile
          </Link>
        }
      />
      <Input
        type="search"
        aria-label="Search people"
        maxLength={80}
        placeholder="Name or username…"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <div className="mt-5 space-y-4">
        {query.length < 2 ? (
          <div className="card p-6 text-sm text-ink-muted">
            Find a friend to start sharing the things you choose. Enter at least
            two characters.
          </div>
        ) : result.error ? (
          <ErrorNote message={(result.error as Error).message} />
        ) : result.isLoading ? (
          <Spinner label="Finding people…" />
        ) : (
          <>
            {result.data?.people.map((person) => (
              <PersonCard key={person.userId} person={person} />
            ))}
            {result.data?.people.length === 0 && (
              <p className="card p-6 text-sm text-ink-muted">
                No people found. Your friend may need to enable “Let people find
                me” in their profile.
              </p>
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
