'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  PAGE_LIMIT_DEFAULT,
  PAGE_LIMIT_MAX,
  PAGE_LIMIT_NONE,
  type AdminAccount,
  type AdminAccountsPage,
  type PortalState,
} from '@life-portal/shared-types';
import { AppShell, PageHeader } from '../../../components/app-shell';
import { OfficialMark } from '../../../components/follow';
import { PageMark } from '../../../components/identity-switcher';
import { ErrorNote, Input, Spinner } from '../../../components/ui';
import { api } from '../../../lib/api';
import { revalidate, useAction, useApi } from '../../../lib/hooks';

export default function PeoplePage() {
  return (
    <AppShell>
      <People />
    </AppShell>
  );
}

type Kind = 'people' | 'pages';
const PAGE_SIZE = 30;

/**
 * People, developer only (spec 040): find an account or a page; set how many pages a person may
 * create; suspend or restore; mark a page official. Names only: no email, nothing they keep.
 */
function People() {
  const portal = useApi<PortalState>('/portal');
  const allowed = portal.data?.cohort === 'developer';
  const [kind, setKind] = useState<Kind>('people');
  const [typed, setTyped] = useState('');
  const [q, setQ] = useState('');
  const [skip, setSkip] = useState(0);
  // Search once typing pauses, from the first page.
  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(typed.trim());
      setSkip(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [typed]);
  const list = useApi<AdminAccountsPage>(allowed ? `/people-admin?kind=${kind}&skip=${skip}${q ? `&q=${encodeURIComponent(q)}` : ''}` : null);
  const action = useAction();
  const act = (fn: () => Promise<unknown>) =>
    action.run(
      async () => {
        await fn();
        await Promise.all([revalidate('/people-admin'), revalidate('/auth/accounts'), revalidate('/pages')]);
      },
      { revalidate: false },
    );

  if (!portal.data) return <Spinner />;
  if (!allowed) return <ErrorNote message="People is for the developer." />;
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="People" subtitle="Accounts and pages: page limits, suspension and the official mark." />
      <div className="mb-3 flex gap-2" role="group" aria-label="Show">
        {(['people', 'pages'] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={kind === value}
            onClick={() => {
              setKind(value);
              setSkip(0);
            }}
            className={clsx(
              'rounded-full border px-3 py-1.5 text-sm font-medium',
              kind === value ? 'border-transparent bg-accent-solid text-on-accent' : 'border-border text-ink-muted',
            )}
          >
            {value === 'people' ? 'People' : 'Pages'}
          </button>
        ))}
      </div>
      <Input
        type="search"
        aria-label="Search by name or username"
        placeholder="Search by name or @username"
        value={typed}
        onChange={(event) => setTyped(event.target.value)}
      />
      <div className="mt-4 space-y-3">
        {action.error && <ErrorNote message={action.error} />}
        {list.error ? (
          <ErrorNote message={(list.error as Error).message} />
        ) : !list.data ? (
          <Spinner />
        ) : list.data.accounts.length === 0 ? (
          <p className="text-sm text-ink-muted">Nobody found.</p>
        ) : (
          <ul className="card divide-y divide-border">
            {list.data.accounts.map((account) => (
              <Row key={account.id} account={account} pending={action.pending} act={act} />
            ))}
          </ul>
        )}
        <div className="flex justify-between">
          {skip > 0 ? (
            <button type="button" className="btn-ghost" onClick={() => setSkip(Math.max(0, skip - PAGE_SIZE))}>
              Newer
            </button>
          ) : (
            <span />
          )}
          {list.data?.hasMore && (
            <button type="button" className="btn-ghost" onClick={() => setSkip(skip + PAGE_SIZE)}>
              Older
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ account, pending, act }: { account: AdminAccount; pending: boolean; act: (fn: () => Promise<unknown>) => Promise<boolean> }) {
  const page = account.kind === 'page';
  return (
    <li className="space-y-2 px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="flex flex-wrap items-center gap-1.5">
            <Link href={`/people/${account.id}`} className="font-medium hover:text-accent-hover">
              {account.name}
            </Link>
            {account.official && <OfficialMark />}
            {page && <PageMark />}
            {account.developer && <span className="text-xs text-ink-faint">you</span>}
            {account.suspended && <span className="text-xs font-semibold text-danger">Suspended</span>}
          </p>
          <p className="text-xs text-ink-faint">
            {account.username ? `@${account.username}` : 'No profile yet'}
            {page
              ? ` · ${account.followerCount ?? 0} followers · run by ${(account.managers ?? []).join(', ') || 'nobody'}${account.aiManaged ? ' · AI' : ''}`
              : ` · ${account.pagesCreated ?? 0} pages created`}
          </p>
        </div>
        {!account.developer && (
          <button
            type="button"
            className={account.suspended ? 'btn-ghost' : 'btn-danger'}
            disabled={pending}
            onClick={() => {
              if (account.suspended) return void act(() => api.post(`/auth/accounts/${account.id}/unsuspend`));
              const reason = window.prompt(`Suspend ${account.name}? ${page ? 'Nobody can use the app as this page' : 'They are signed out and cannot sign in'}, and what was posted is hidden. Reason (optional):`);
              if (reason !== null) void act(() => api.post(`/auth/accounts/${account.id}/suspend`, { reason }));
            }}
          >
            {account.suspended ? 'Restore' : 'Suspend'}
          </button>
        )}
      </div>
      {page ? (
        <label className="flex items-center gap-2 text-xs text-ink-muted">
          <input
            type="checkbox"
            checked={!!account.official}
            disabled={pending}
            onChange={(event) => void act(() => api.put(`/pages/${account.id}/official`, { official: event.target.checked }))}
          />
          Official LifePortal page
        </label>
      ) : account.developer ? (
        <p className="text-xs text-ink-faint">No page limit.</p>
      ) : (
        <PageLimit account={account} pending={pending} act={act} />
      )}
    </li>
  );
}

const describe = (limit: number | undefined) =>
  limit === undefined ? `Default (${PAGE_LIMIT_DEFAULT})` : limit === PAGE_LIMIT_NONE ? 'No limit' : String(limit);

/** How many pages this person may create: the default, a number of your choosing, or no limit. */
function PageLimit({ account, pending, act }: { account: AdminAccount; pending: boolean; act: (fn: () => Promise<unknown>) => Promise<boolean> }) {
  const [custom, setCustom] = useState('');
  const set = (limit: number | null) => act(() => api.put(`/people-admin/${account.id}/page-limit`, { limit }));
  const number = Number(custom);
  const valid = custom !== '' && Number.isInteger(number) && number >= 0 && number <= PAGE_LIMIT_MAX;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
      <span>
        Page limit: <span className="font-semibold text-ink">{describe(account.pageLimit)}</span>
      </span>
      {account.pageLimit !== undefined && (
        <button type="button" className="btn-ghost" disabled={pending} onClick={() => void set(null)}>
          Default
        </button>
      )}
      {account.pageLimit !== PAGE_LIMIT_NONE && (
        <button type="button" className="btn-ghost" disabled={pending} onClick={() => void set(PAGE_LIMIT_NONE)}>
          No limit
        </button>
      )}
      <Input
        inputMode="numeric"
        aria-label={`Page limit for ${account.name}`}
        placeholder="Number"
        className="w-24"
        value={custom}
        onChange={(event) => setCustom(event.target.value.replace(/\D/g, ''))}
      />
      <button
        type="button"
        className="btn-ghost"
        disabled={pending || !valid}
        onClick={() => void set(number).then((ok) => ok && setCustom(''))}
      >
        Set
      </button>
    </div>
  );
}
