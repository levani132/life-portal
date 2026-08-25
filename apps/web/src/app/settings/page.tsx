'use client';

import type {
  Currency,
  FxRatePoint,
  UserSettings,
} from '@life-portal/shared-types';
import { SUPPORTED_CURRENCIES } from '@life-portal/shared-types';
import { formatDay } from '@life-portal/shared-domain';
import { AppShell, PageHeader } from '../../components/app-shell';
import {
  ErrorNote,
  Field,
  Input,
  Panel,
  Select,
  Spinner,
} from '../../components/ui';
import { api } from '../../lib/api';
import { useAction, useApi } from '../../lib/hooks';

interface FxStatus {
  today: string;
  base: Currency;
  inForce: FxRatePoint | null;
  fetchedAt: string | null;
  pointCount: number;
}

const CURRENCY_LABEL: Record<string, string> = {
  GEL: 'Georgian lari (₾)',
  USD: 'US dollar ($)',
  EUR: 'Euro (€)',
};

export default function SettingsPage() {
  return (
    <AppShell>
      <Settings />
    </AppShell>
  );
}

function Settings() {
  const settings = useApi<UserSettings>('/settings');
  const fx = useApi<FxStatus>('/fx');
  const { run, pending, error } = useAction();

  if (settings.isLoading) return <Spinner />;
  if (settings.error)
    return <ErrorNote message={(settings.error as Error).message} />;
  if (!settings.data) return null;

  const current = settings.data;

  const save = (patch: Partial<UserSettings>) =>
    run(async () => {
      await api.put('/settings', patch);
      await settings.mutate();
      await fx.mutate();
    });

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="How the numbers are shown. None of this changes what was recorded."
      />

      {error && <ErrorNote message={error} />}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="Display currency"
          description="Everything is converted into this on the way out. Amounts keep the currency they were entered in."
        >
          <Field
            label="Show all figures in"
            hint="A dollar salary stays a dollar salary — only what you read changes."
          >
            <Select
              value={current.displayCurrency}
              disabled={pending}
              onChange={(event) =>
                save({ displayCurrency: event.target.value as Currency })
              }
            >
              {SUPPORTED_CURRENCIES.map((code) => (
                <option key={code} value={code}>
                  {CURRENCY_LABEL[code] ?? code}
                </option>
              ))}
            </Select>
          </Field>

          <div className="mt-4">
            <FxRates
              status={fx.data}
              error={fx.error as Error | undefined}
              refreshing={pending}
              onRefresh={() =>
                run(async () => {
                  await api.post('/fx/refresh', {});
                  await fx.mutate();
                })
              }
            />
          </div>
        </Panel>

        <Panel
          title="Other"
          description="Small things the projections depend on."
        >
          <div className="grid gap-4">
            <Field
              label="Salary day of the month"
              hint="Lines the projection up with payday."
            >
              <Input
                type="number"
                min={1}
                max={31}
                defaultValue={current.salaryDayOfMonth}
                disabled={pending}
                onBlur={(event) => {
                  const value = Number(event.target.value);
                  const changed = value !== current.salaryDayOfMonth;
                  if (
                    Number.isInteger(value) &&
                    value >= 1 &&
                    value <= 31 &&
                    changed
                  ) {
                    save({ salaryDayOfMonth: value });
                  }
                }}
              />
            </Field>

            <Field
              label="Capital gains tax rate (%)"
              hint="Applied to modelled share-sale proceeds. Georgia taxes most personal share sales at 0%."
            >
              <Input
                type="number"
                min={0}
                max={100}
                step={0.5}
                defaultValue={
                  Math.round(current.capitalGainsTaxRate * 1000) / 10
                }
                disabled={pending}
                onBlur={(event) => {
                  const pct = Number(event.target.value);
                  if (!Number.isFinite(pct) || pct < 0 || pct > 100) return;
                  const rate = Math.round((pct / 100) * 10_000) / 10_000;
                  if (rate !== current.capitalGainsTaxRate)
                    save({ capitalGainsTaxRate: rate });
                }}
              />
            </Field>
          </div>
        </Panel>
      </div>
    </>
  );
}

/**
 * The rate the app is actually converting at.
 *
 * Worth a panel rather than hiding: with no rate available every figure quietly falls back to
 * the currency it was recorded in, and without this there is nothing to say why.
 */
function FxRates({
  status,
  error,
  onRefresh,
  refreshing,
}: {
  status?: FxStatus;
  error?: Error;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  if (error) return <ErrorNote message={error.message} />;
  if (!status)
    return <p className="text-xs text-ink-faint">Checking exchange rates…</p>;

  const rates = status.inForce?.rates ?? {};
  const codes = Object.keys(rates).sort();

  return (
    <div className="rounded-lg border border-line/60 bg-surface-sunken/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-ink">Exchange rates</h3>
        <button
          type="button"
          className="btn-ghost text-xs"
          onClick={onRefresh}
          disabled={refreshing}
        >
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {codes.length ? (
        <>
          <ul className="mt-2 space-y-1">
            {codes.map((code) => (
              <li
                key={code}
                className="flex items-baseline justify-between gap-3 text-xs"
              >
                <span className="text-ink-muted">1 {code}</span>
                <span className="tabular-nums text-ink">
                  {rates[code].toFixed(4)} {status.base}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-ink-faint">
            National Bank of Georgia, for{' '}
            {formatDay(status.inForce?.date ?? status.today)} ·{' '}
            {status.pointCount} day{status.pointCount === 1 ? '' : 's'} on
            record
          </p>
        </>
      ) : (
        <p className="mt-2 text-xs text-amber-400">
          No rate for today yet, so amounts are shown in the currency they were
          recorded in.
        </p>
      )}
    </div>
  );
}
