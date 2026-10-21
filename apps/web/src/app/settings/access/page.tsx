'use client';
import { useState } from 'react';
import {
  COHORTS,
  FEATURES,
  type AccessUser,
  type CohortPolicy,
  type FeatureAccess,
  type PortalState,
  type UserCohort,
} from '@life-portal/shared-types';
import { AppShell, PageHeader } from '../../../components/app-shell';
import { ErrorNote, Field, Select, Spinner } from '../../../components/ui';
import { api } from '../../../lib/api';
import { revalidate, useAction, useApi } from '../../../lib/hooks';
export default function AccessPage() {
  return (
    <AppShell>
      <Access />
    </AppShell>
  );
}
function Access() {
  const portal = useApi<PortalState>('/portal');
  const developer = portal.data?.cohort === 'developer';
  const users = useApi<AccessUser[]>(developer ? '/access/users' : null);
  const policies = useApi<CohortPolicy[]>(
    developer ? '/access/users/policies' : null,
  );
  const [target, setTarget] = useState('cohort:production');
  if (
    portal.isLoading ||
    (developer && (users.isLoading || policies.isLoading))
  )
    return <Spinner />;
  if (!developer) return <ErrorNote message="Developer access is required." />;
  if (users.error || policies.error)
    return (
      <ErrorNote message={((users.error || policies.error) as Error).message} />
    );
  const user = users.data?.find((u) => u.id === target);
  const policy = policies.data?.find((p) => `cohort:${p.cohort}` === target);
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Feature access"
        subtitle="Choose defaults for each audience, or override an individual account."
      />
      <Field label="Manage access for">
        <Select
          value={target}
          onChange={(event) => setTarget(event.target.value)}
        >
          {COHORTS.map((cohort) => (
            <option key={cohort} value={`cohort:${cohort}`}>
              {cohort === 'production'
                ? 'All production users'
                : 'All internal users'}
            </option>
          ))}
          {users.data
            ?.filter((u) => u.cohort !== 'developer')
            .map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} · {u.id.slice(-6)}
              </option>
            ))}
        </Select>
      </Field>
      {(user || policy) && (
        <AccessEditor
          key={target}
          target={target}
          user={user}
          policy={policy}
          onSaved={async () => {
            await users.mutate();
            await policies.mutate();
            await revalidate('/portal');
          }}
        />
      )}
      <p className="mt-6 text-xs text-ink-faint">
        The developer account always has all modules. EPAM is available only to
        that account. Changes apply to API access immediately; hidden modules
        retain their data.
      </p>
    </div>
  );
}
function AccessEditor({
  target,
  user,
  policy,
  onSaved,
}: {
  target: string;
  user?: AccessUser;
  policy?: CohortPolicy;
  onSaved: () => Promise<void>;
}) {
  const [cohort, setCohort] = useState<UserCohort>(
    policy?.cohort ?? (user?.cohort === 'internal' ? 'internal' : 'production'),
  );
  const [overrides, setOverrides] = useState<Partial<FeatureAccess>>(
    user?.overrides ?? policy?.overrides ?? {},
  );
  const [saved, setSaved] = useState(false);
  const action = useAction();
  return (
    <form
      className="card mt-5 space-y-4 p-5"
      onSubmit={(event) => {
        event.preventDefault();
        setSaved(false);
        void action.run(
          async () => {
            await api.put(
              target.startsWith('cohort:')
                ? '/access/users/policies'
                : `/access/users/${target}`,
              { cohort, overrides },
            );
            await onSaved();
            setSaved(true);
          },
          { revalidate: false },
        );
      }}
    >
      <fieldset disabled={action.pending} className="space-y-4">
        {user && (
          <Field label="User group">
            <Select
              value={cohort}
              onChange={(event) => {
                setCohort(event.target.value as UserCohort);
                setSaved(false);
              }}
            >
              <option value="production">Production</option>
              <option value="internal">Internal</option>
            </Select>
          </Field>
        )}
        {FEATURES.filter((m) => m.id !== 'epam').map((m) => (
          <label key={m.id} className="flex items-center justify-between gap-4">
            <span>{m.name}</span>
            <span className="w-40">
              <Select
                aria-label={`${m.name} feature access`}
                value={
                  overrides[m.id] === undefined
                    ? 'default'
                    : String(overrides[m.id])
                }
                onChange={(event) => {
                  const value = event.target.value;
                  setOverrides((current) => {
                    const next = { ...current };
                    if (value === 'default') delete next[m.id];
                    else next[m.id] = value === 'true';
                    return next;
                  });
                  setSaved(false);
                }}
              >
                <option value="default">
                  {user ? 'Group default' : 'Built-in default'}
                </option>
                <option value="true">Enabled</option>
                <option value="false">Disabled</option>
              </Select>
            </span>
          </label>
        ))}
        {action.error && <ErrorNote message={action.error} />}
        <div className="flex items-center gap-3">
          <button className="btn btn-primary" disabled={action.pending}>
            {action.pending ? 'Saving…' : 'Save access'}
          </button>
          {saved && (
            <span role="status" className="text-sm text-emerald-400">
              Saved
            </span>
          )}
        </div>
      </fieldset>
    </form>
  );
}
