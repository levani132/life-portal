'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type {
  Cadence,
  CashBalance,
  CashEvent,
  CashProjection,
  CashProjectionDay,
  CashflowSummary,
  Currency,
  Expense,
  IncomeSource,
  RealisedSale,
} from '@life-portal/shared-types';
import {
  CASHFLOW_CADENCES,
  EXPENSE_CATEGORIES,
} from '@life-portal/shared-types';
import {
  addMonths,
  buildCashEvents,
  describeRecurrence,
  formatCents,
  formatDay,
  formatMonth,
  monthlyEquivalentCents,
  relativeDays,
  salesOnDay,
  snapshotAt,
  sumCents,
} from '@life-portal/shared-domain';
import { AppShell, PageHeader } from '../../components/app-shell';
import {
  Chip,
  EmptyState,
  ErrorNote,
  EstimateMark,
  Field,
  Input,
  Modal,
  Money,
  MoneyInput,
  Panel,
  Select,
  Spinner,
} from '../../components/ui';
import { api } from '../../lib/api';
import { useAction, useApi, useDefaultCurrency } from '../../lib/hooks';

interface CashflowOverview {
  today: string;
  summary: CashflowSummary;
  projection: CashProjection;
  incomes: IncomeSource[];
  expenses: Expense[];
  /** Cash from things already sold — derived by the API from the item and lot rows. */
  sales: RealisedSale[];
  breakdown: { category: string; monthlyCents: number }[];
  balanceHistory: CashBalance[];
}

export default function CashflowPage() {
  return (
    <AppShell>
      <Cashflow />
    </AppShell>
  );
}

function Cashflow() {
  const [snapshotDate, setSnapshotDate] = useState<string | null>(null);
  const { data, error, isLoading } = useApi<CashflowOverview>('/cashflow');

  const [editingBalance, setEditingBalance] = useState(false);
  const [addingIncome, setAddingIncome] = useState(false);
  const [addingExpense, setAddingExpense] = useState<ExpensePreset | null>(
    null,
  );

  // Only block on the very first load: a revalidation after a write must not tear the page
  // down to a spinner and lose every panel's local state.
  if (isLoading && !data) return <Spinner />;
  if (error) return <ErrorNote message={(error as Error).message} />;
  if (!data) return null;

  const { summary, projection } = data;
  // Picking a date is arithmetic over the projection we already hold, not a new request —
  // `snapshotAt` is the same pure function the API calls, so the numbers cannot diverge.
  const snapshot = snapshotDate
    ? snapshotAt(projection, snapshotDate, data.today)
    : projection.snapshot;

  return (
    <>
      <PageHeader
        title="Free money"
        subtitle={`Balance last reconciled ${formatDay(summary.balanceAsOf)} at ${formatCents(summary.reconciledBalanceCents, summary.currency)}`}
        actions={
          <>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setAddingIncome(true)}
            >
              Add income
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() =>
                setAddingExpense({ kind: 'recurring', cadence: 'monthly' })
              }
            >
              Add spending
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => setEditingBalance(true)}
            >
              Update balance
            </button>
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <BigStat
          label="On hand now"
          value={formatCents(summary.currentBalanceCents, summary.currency)}
          hint={
            summary.balanceAsOf === data.today
              ? 'reconciled today'
              : `projected from ${formatCents(summary.reconciledBalanceCents, summary.currency)} on ${formatDay(summary.balanceAsOf)}`
          }
          estimated={summary.balanceAsOf !== data.today}
        />
        <BigStat
          label="Free to spend"
          value={formatCents(summary.freeTodayCents, summary.currency)}
          tone={
            summary.freeTodayCents < 0
              ? 'bad'
              : summary.freeTodayCents < 20_000
                ? 'warn'
                : 'good'
          }
          hint="after everything due before payday"
          estimated
        />
        <BigStat
          label="Next salary"
          value={
            summary.nextIncomeDate
              ? formatCents(
                  summary.nextIncomeAmountCents ?? 0,
                  summary.currency,
                )
              : 'not set'
          }
          hint={
            summary.nextIncomeDate
              ? `${formatDay(summary.nextIncomeDate)} · ${relativeDays(data.today, summary.nextIncomeDate)}`
              : 'add your salary as an income source'
          }
        />
        <BigStat
          label="Monthly net"
          value={formatCents(summary.monthlyNetCents, summary.currency)}
          tone={summary.monthlyNetCents >= 0 ? 'good' : 'bad'}
          hint="income minus recurring spending"
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-5">
          <Panel
            title="What happens to your money"
            description="Projected balance, day by day. Pick a date to see what is free then."
          >
            <ProjectionChart
              projection={projection}
              today={data.today}
              currency={summary.currency}
            />
          </Panel>

          <Panel
            title="On a specific date"
            description="The three numbers that actually matter for planning."
            actions={
              <Input
                type="date"
                className="w-auto"
                value={snapshotDate ?? data.today}
                min={data.today}
                max={projection.to}
                onChange={(event) => setSnapshotDate(event.target.value)}
              />
            }
          >
            <div className="grid gap-4 sm:grid-cols-3">
              <SnapshotStat
                label={`Balance on ${formatDay(snapshot.date)}`}
                cents={snapshot.projectedBalanceCents}
                currency={summary.currency}
              />
              <SnapshotStat
                label={
                  snapshot.nextIncomeDate
                    ? `Due before ${formatDay(snapshot.nextIncomeDate)}`
                    : 'Due before more income'
                }
                cents={snapshot.committedBeforeNextIncomeCents}
                currency={summary.currency}
                tone="warn"
              />
              <SnapshotStat
                label="Genuinely free"
                cents={snapshot.freeCents}
                currency={summary.currency}
                tone={snapshot.freeCents < 0 ? 'bad' : 'good'}
              />
            </div>

            <p className="mt-4 text-xs text-ink-faint">
              Money due <em>on</em> payday is paid from that salary, so it is
              not counted against the balance beforehand. The lowest point
              between now and then is{' '}
              <span className="text-ink-muted">
                {formatCents(snapshot.lowestBalanceCents, summary.currency)} on{' '}
                {formatDay(snapshot.lowestBalanceDate)}
              </span>
              .
            </p>

            {projection.firstShortfallDate && (
              <div className="mt-3">
                <ErrorNote
                  message={`On this plan you run out of money on ${formatDay(projection.firstShortfallDate)}.`}
                />
              </div>
            )}
          </Panel>
        </div>

        <div className="space-y-5">
          <Panel title="Income" description="What comes in, and when.">
            {data.incomes.length === 0 ? (
              <EmptyState
                message="No income set up. Add your salary so projections mean something."
                action={
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => setAddingIncome(true)}
                  >
                    Add income
                  </button>
                }
              />
            ) : (
              <ul className="space-y-2">
                {data.incomes.map((income) => (
                  <IncomeRow
                    key={income.id}
                    income={income}
                    currency={summary.currency}
                  />
                ))}
              </ul>
            )}
          </Panel>

          <Panel
            title="Where it goes each month"
            description="Recurring spending by category."
          >
            {data.breakdown.length === 0 ? (
              <EmptyState message="No recurring spending recorded." />
            ) : (
              <ul className="space-y-2">
                {data.breakdown.map((row) => {
                  const share = summary.monthlyNetCents
                    ? row.monthlyCents /
                      Math.max(
                        1,
                        data.breakdown.reduce(
                          (sum, r) => sum + r.monthlyCents,
                          0,
                        ),
                      )
                    : 0;
                  return (
                    <li key={row.category}>
                      <div className="mb-1 flex justify-between text-sm">
                        <span className="capitalize text-ink-muted">
                          {row.category}
                        </span>
                        <Money
                          cents={row.monthlyCents}
                          currency={summary.currency}
                        />
                      </div>
                      <div className="h-1 overflow-hidden rounded-full bg-border">
                        <div
                          className="h-full rounded-full bg-sky-500/70"
                          style={{ width: `${Math.round(share * 100)}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          {summary.runway && (
            <Panel title="Runway">
              <p className="tabular text-2xl font-semibold">
                {summary.runway.value} days
                <EstimateMark basis={summary.runway.basis} />
              </p>
              <p className="mt-1 text-xs text-ink-faint">
                {summary.runway.basis}
              </p>
            </Panel>
          )}
        </div>
      </div>

      <RecurringSpending
        expenses={data.expenses}
        currency={summary.currency}
        onAdd={(cadence) => setAddingExpense({ kind: 'recurring', cadence })}
      />

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <OneOffSpending
          expenses={data.expenses}
          today={data.today}
          currency={summary.currency}
          onAdd={(date) => setAddingExpense({ kind: 'one_off', date })}
        />
        <DayState
          today={data.today}
          projection={projection}
          expenses={data.expenses}
          incomes={data.incomes}
          sales={data.sales ?? []}
          currency={summary.currency}
        />
      </div>

      <BalanceModal
        open={editingBalance}
        onClose={() => setEditingBalance(false)}
        today={data.today}
        currency={summary.currency}
        currentCents={summary.currentBalanceCents}
        reconciled={{
          cents: summary.reconciledBalanceCents,
          asOf: summary.balanceAsOf,
        }}
      />
      <IncomeModal
        open={addingIncome}
        onClose={() => setAddingIncome(false)}
        today={data.today}
      />
      {/* Mounted only while open, so each preset starts from a clean form. */}
      {addingExpense && (
        <ExpenseModal
          preset={addingExpense}
          onClose={() => setAddingExpense(null)}
          today={data.today}
        />
      )}
    </>
  );
}

function BigStat({
  label,
  value,
  hint,
  tone,
  estimated,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'good' | 'warn' | 'bad';
  estimated?: boolean;
}) {
  return (
    <div className="card p-4">
      <p className="text-xs uppercase tracking-wide text-ink-faint">{label}</p>
      <p
        className={clsx(
          'tabular mt-1 text-xl font-semibold',
          tone === 'good' && 'text-emerald-400',
          tone === 'warn' && 'text-amber-400',
          tone === 'bad' && 'text-rose-400',
        )}
      >
        {value}
        {estimated && (
          <EstimateMark basis="Projected from your income and planned spending." />
        )}
      </p>
      {hint && <p className="mt-0.5 text-[11px] text-ink-faint">{hint}</p>}
    </div>
  );
}

function SnapshotStat({
  label,
  cents,
  currency,
  tone,
}: {
  label: string;
  cents: number;
  currency: string;
  tone?: 'good' | 'warn' | 'bad';
}) {
  return (
    <div>
      <p className="text-xs text-ink-faint">{label}</p>
      <p
        className={clsx(
          'tabular mt-1 text-lg font-semibold',
          tone === 'good' && 'text-emerald-400',
          tone === 'warn' && 'text-amber-400',
          tone === 'bad' && 'text-rose-400',
        )}
      >
        {formatCents(cents, currency)}
      </p>
    </div>
  );
}

/** Weekly sampling keeps a year-long projection readable and the DOM small. */
function ProjectionChart({
  projection,
  today,
  currency,
}: {
  projection: CashProjection;
  today: string;
  currency: string;
}) {
  const points = useMemo(
    () =>
      projection.days
        .filter((day, index) => index % 7 === 0 || day.date === today)
        .map((day) => ({ date: day.date, balance: day.closingCents / 100 })),
    [projection.days, today],
  );

  if (points.length === 0)
    return <EmptyState message="Nothing to project yet." />;

  return (
    <div className="h-60">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={points}
          margin={{ top: 5, right: 5, bottom: 0, left: 0 }}
        >
          <defs>
            <linearGradient id="balanceFill" x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="0%"
                stopColor="rgb(56 189 248)"
                stopOpacity={0.35}
              />
              <stop offset="100%" stopColor="rgb(56 189 248)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="rgb(40 45 58)" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fill: 'rgb(106 114 130)', fontSize: 11 }}
            tickFormatter={(value: string) => value.slice(5)}
            stroke="rgb(40 45 58)"
            minTickGap={28}
          />
          <YAxis
            tick={{ fill: 'rgb(106 114 130)', fontSize: 11 }}
            stroke="rgb(40 45 58)"
            tickFormatter={(value: number) => `${Math.round(value / 1000)}k`}
            width={44}
          />
          {/* Zero line matters more than any gridline: crossing it is the failure case. */}
          <ReferenceLine y={0} stroke="rgb(244 63 94)" strokeDasharray="3 3" />
          <Tooltip
            contentStyle={{
              background: 'rgb(22 25 34)',
              border: '1px solid rgb(40 45 58)',
              borderRadius: 8,
              fontSize: 12,
            }}
            labelFormatter={(label) =>
              typeof label === 'string' ? formatDay(label) : ''
            }
            formatter={(value) =>
              [
                formatCents(Math.round(Number(value) * 100), currency),
                'Balance',
              ] as [string, string]
            }
          />
          <Area
            type="monotone"
            dataKey="balance"
            stroke="rgb(56 189 248)"
            strokeWidth={2}
            fill="url(#balanceFill)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function IncomeRow({
  income,
  currency,
}: {
  income: IncomeSource;
  currency: string;
}) {
  const { run, pending } = useAction();
  return (
    <li className="flex items-start justify-between gap-3 rounded-lg border border-border px-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-sm">{income.label}</p>
        <p className="text-xs text-ink-faint">
          {describeRecurrence(income.recurrence)}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <Money cents={income.amountCents} currency={currency} tone="good" />
        {income.amountCents === 0 && (
          <p className="text-[11px] text-amber-400">set the real amount</p>
        )}
        <button
          type="button"
          className="mt-0.5 block w-full text-[11px] text-ink-faint hover:text-rose-400"
          disabled={pending}
          onClick={() =>
            void run(() => api.delete(`/cashflow/incomes/${income.id}`))
          }
        >
          remove
        </button>
      </div>
    </li>
  );
}

/** The `+` in a panel header. Icon-only, so it carries its own label for screen readers. */
function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="btn-ghost px-2 py-1 text-base leading-none"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      +
    </button>
  );
}

/**
 * Each cadence gets its own panel rather than one flat list: a daily food habit and a yearly
 * insurance premium are different problems, and reading them interleaved hides both.
 * `unscheduled` catches a recurring row whose recurrence is missing — better shown than dropped.
 */
type RecurringGroupKey = Cadence | 'unscheduled';

const RECURRING_GROUPS: {
  key: RecurringGroupKey;
  label: string;
  empty: string;
}[] = [
  { key: 'daily', label: 'Daily', empty: 'Nothing repeats daily.' },
  { key: 'weekly', label: 'Weekly', empty: 'Nothing repeats weekly.' },
  { key: 'monthly', label: 'Monthly', empty: 'Nothing repeats monthly.' },
  { key: 'yearly', label: 'Yearly', empty: 'Nothing repeats yearly.' },
  {
    key: 'unscheduled',
    label: 'No schedule',
    empty: 'Nothing without a schedule.',
  },
];

const MONTHLY_EQUIVALENT_BASIS =
  'Monthly equivalent: daily × 30.44, weekly × 4.35, yearly ÷ 12. The day-by-day projection is the authority.';

/** Paused rows are out of the projection, so they are out of the monthly figure too. */
function monthlyTotalCents(expenses: Expense[]): number {
  return sumCents(
    expenses.map((expense) =>
      expense.active && expense.recurrence
        ? monthlyEquivalentCents(expense.amountCents, expense.recurrence)
        : 0,
    ),
  );
}

function RecurringSpending({
  expenses,
  currency,
  onAdd,
}: {
  expenses: Expense[];
  currency: string;
  onAdd: (cadence: Cadence) => void;
}) {
  const groups = useMemo(() => {
    const buckets = new Map<RecurringGroupKey, Expense[]>();
    for (const expense of expenses) {
      if (expense.kind !== 'recurring') continue;
      const key: RecurringGroupKey =
        expense.recurrence?.cadence ?? 'unscheduled';
      const bucket = buckets.get(key);
      if (bucket) bucket.push(expense);
      else buckets.set(key, [expense]);
    }
    return buckets;
  }, [expenses]);

  // The malformed-row panel only exists when there is something in it.
  const visible = RECURRING_GROUPS.filter(
    (group) =>
      group.key !== 'unscheduled' ||
      (groups.get('unscheduled')?.length ?? 0) > 0,
  );
  const everything = [...groups.values()].flat();

  return (
    <section className="mt-5">
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-ink">Recurring spending</h2>
          <p className="mt-0.5 text-xs text-ink-faint">
            One view per cadence, because a daily cost and a yearly one are not
            the same problem.
          </p>
        </div>
        {everything.length > 0 && (
          <p className="tabular text-xs text-ink-muted">
            ≈ {formatCents(monthlyTotalCents(everything), currency)}/month in
            total
            <EstimateMark basis={MONTHLY_EQUIVALENT_BASIS} />
          </p>
        )}
      </header>

      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {visible.map((group) => {
          const rows = groups.get(group.key) ?? [];
          const monthlyCents = monthlyTotalCents(rows);
          return (
            <Panel
              key={group.key}
              title={group.label}
              description={`${rows.length} ${rows.length === 1 ? 'entry' : 'entries'}`}
              actions={
                group.key === 'unscheduled' ? undefined : (
                  <AddButton
                    label={`Add ${group.label.toLowerCase()} spending`}
                    onClick={() => onAdd(group.key as Cadence)}
                  />
                )
              }
            >
              {rows.length === 0 ? (
                <EmptyState
                  message={group.empty}
                  action={
                    group.key === 'unscheduled' ? undefined : (
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={() => onAdd(group.key as Cadence)}
                      >
                        Add one
                      </button>
                    )
                  }
                />
              ) : (
                <>
                  <ExpenseList
                    expenses={rows}
                    currency={currency}
                    showMonthlyEquivalent={group.key !== 'monthly'}
                  />
                  {monthlyCents > 0 && (
                    <p className="tabular mt-3 border-t border-border pt-3 text-right text-xs text-ink-muted">
                      ≈ {formatCents(monthlyCents, currency)}/month
                      <EstimateMark basis={MONTHLY_EQUIVALENT_BASIS} />
                    </p>
                  )}
                </>
              )}
            </Panel>
          );
        })}
      </div>
    </section>
  );
}

/** One-off spending, one month at a time — the only way a long tail of dated items stays readable. */
function OneOffSpending({
  expenses,
  today,
  currency,
  onAdd,
}: {
  expenses: Expense[];
  today: string;
  currency: string;
  /** Called with the first day of the month on screen, so the form opens where you are looking. */
  onAdd: (date: string) => void;
}) {
  const oneOffs = useMemo(
    () =>
      expenses
        .filter(
          (expense) => expense.kind === 'one_off' && Boolean(expense.date),
        )
        .sort((a, b) => ((a.date ?? '') < (b.date ?? '') ? -1 : 1)),
    [expenses],
  );
  const thisMonth = today.slice(0, 7);
  const [month, setMonth] = useState(thisMonth);

  const rows = oneOffs.filter((expense) => expense.date?.startsWith(month));
  // Paused rows are out of the projections, so they stay out of the total too.
  const totalCents = sumCents(
    rows.map((expense) => (expense.active ? expense.amountCents : 0)),
  );
  const pausedCount = rows.filter((expense) => !expense.active).length;
  const monthsWithEntries = [
    ...new Set(oneOffs.map((expense) => (expense.date ?? '').slice(0, 7))),
  ];

  const shift = (delta: number) =>
    setMonth(addMonths(`${month}-01`, delta).slice(0, 7));

  return (
    <Panel
      title="One-off spending"
      description="Everything that happens once, by the month it falls in."
      actions={
        <>
          <button
            type="button"
            className="btn-ghost px-2"
            aria-label="Previous month"
            onClick={() => shift(-1)}
          >
            ‹
          </button>
          <Input
            type="month"
            className="w-auto"
            value={month}
            onChange={(event) => setMonth(event.target.value || thisMonth)}
          />
          <button
            type="button"
            className="btn-ghost px-2"
            aria-label="Next month"
            onClick={() => shift(1)}
          >
            ›
          </button>
          <AddButton
            label={`Add a one-off in ${formatMonth(month)}`}
            onClick={() => onAdd(`${month}-01`)}
          />
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          message={`Nothing one-off in ${formatMonth(month)}.`}
          action={
            <button
              type="button"
              className="btn-ghost"
              onClick={() => onAdd(`${month}-01`)}
            >
              Add one
            </button>
          }
        />
      ) : (
        <>
          <ExpenseList expenses={rows} currency={currency} />
          <div className="mt-3 flex items-center justify-between border-t border-border pt-3 text-xs">
            <span className="text-ink-faint">{formatMonth(month)}</span>
            <span className="tabular text-ink-muted">
              {formatCents(totalCents, currency)}
              {pausedCount > 0 ? ` · ${pausedCount} paused, not counted` : ''}
            </span>
          </div>
        </>
      )}

      {monthsWithEntries.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border pt-3">
          <span className="mr-1 text-[11px] uppercase tracking-wide text-ink-faint">
            Jump to
          </span>
          {monthsWithEntries.map((key) => (
            <button
              key={key}
              type="button"
              className={clsx(
                'rounded-full border px-2 py-0.5 text-[11px] transition',
                key === month
                  ? 'border-sky-500/50 bg-sky-500/10 text-sky-200'
                  : 'border-border text-ink-muted hover:border-ink-faint hover:text-ink',
              )}
              onClick={() => setMonth(key)}
            >
              {formatMonth(key)}
            </button>
          ))}
        </div>
      )}
    </Panel>
  );
}

/** What to say about an event beyond its amount: where it came from, and why it is there. */
function eventMeta(
  event: CashEvent,
  context: {
    expenses: Expense[];
    incomes: IncomeSource[];
    sales: RealisedSale[];
  },
): {
  note: string;
  chip?: { label: string; href: string; tone: 'good' | 'warn' };
} {
  if (event.sourceKind === 'income') {
    const income = context.incomes.find((row) => row.id === event.sourceId);
    return { note: income ? describeRecurrence(income.recurrence) : 'income' };
  }

  if (event.sourceKind === 'sale') {
    const sale = context.sales.find((row) => row.id === event.sourceId);
    const partlyEarmarked = sale && sale.amountCents < sale.grossCents;
    return {
      note: [
        sale?.source === 'stock' ? 'shares sold' : 'sold',
        partlyEarmarked
          ? `${formatCents(sale.grossCents, 'USD')} in total, the rest earmarked for a debt`
          : undefined,
      ]
        .filter(Boolean)
        .join(' · '),
      chip: {
        label: sale?.source === 'stock' ? 'shares' : 'item',
        href: sale?.source === 'stock' ? '/stocks' : '/items',
        tone: 'good',
      },
    };
  }

  const expense = context.expenses.find((row) => row.id === event.sourceId);
  const schedule =
    expense?.kind === 'recurring' && expense.recurrence
      ? describeRecurrence(expense.recurrence)
      : 'one-off';
  return {
    note: event.category ? `${event.category} · ${schedule}` : schedule,
    chip: event.linkedLoanId
      ? { label: 'debt', href: '/loans', tone: 'warn' }
      : undefined,
  };
}

/**
 * One day in full: what the balance does across it, and everything that lands on it — salary,
 * recurring spending, one-offs and cash from things sold.
 *
 * The events are rebuilt here with the same pure function the projection uses, so **any** date
 * works, including dates before the last reconciliation. Balances cannot go back that far (the
 * projection starts at the reconciliation), so those two figures read as "—" instead of guessing.
 */
function DayState({
  today,
  projection,
  expenses,
  incomes,
  sales,
  currency,
}: {
  today: string;
  projection: CashProjection;
  expenses: Expense[];
  incomes: IncomeSource[];
  sales: RealisedSale[];
  currency: string;
}) {
  const [date, setDate] = useState(today);

  const events = useMemo(
    () => buildCashEvents({ incomes, expenses, sales }, date, date),
    [incomes, expenses, sales, date],
  );
  // Sales whose proceeds are wholly earmarked never become cash, so they are not cash events —
  // but they did happen on this day, and hiding them would look like nothing happened.
  const earmarkedSales = useMemo(
    () => salesOnDay(sales, date).filter((sale) => sale.amountCents <= 0),
    [sales, date],
  );

  const day: CashProjectionDay | undefined = projection.days.find(
    (row) => row.date === date,
  );
  const inCents = sumCents(
    events.filter((e) => e.direction === 'in').map((e) => e.amountCents),
  );
  const outCents = sumCents(
    events.filter((e) => e.direction === 'out').map((e) => e.amountCents),
  );

  return (
    <Panel
      title="State on a specific day"
      description="What lands that day, and what it does to the balance."
      actions={
        <Input
          type="date"
          className="w-auto"
          value={date}
          max={projection.to}
          onChange={(event) => setDate(event.target.value || today)}
        />
      }
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <DayFigure
          label="Opening"
          cents={day?.openingCents}
          currency={currency}
        />
        <DayFigure
          label="In"
          cents={inCents}
          currency={currency}
          tone={inCents ? 'good' : undefined}
        />
        <DayFigure
          label="Out"
          cents={outCents}
          currency={currency}
          tone={outCents ? 'warn' : undefined}
        />
        <DayFigure
          label="Closing"
          cents={day?.closingCents}
          currency={currency}
          tone={day && day.closingCents < 0 ? 'bad' : undefined}
        />
      </div>

      {!day && (
        <p className="mt-2 text-xs text-ink-faint">
          Balances are only projected from the last reconciliation (
          {formatDay(projection.from)}) onward, so this day shows what moved,
          not what was in the account.
        </p>
      )}

      <div className="mt-4 border-t border-border pt-3">
        <p className="mb-1 text-[11px] uppercase tracking-wide text-ink-faint">
          {formatDay(date)}
        </p>

        {events.length === 0 && earmarkedSales.length === 0 ? (
          <p className="py-2 text-xs text-ink-faint">
            Nothing on this date — no salary, no recurring payment, no one-off,
            nothing sold.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {events.map((event, index) => {
              const meta = eventMeta(event, { expenses, incomes, sales });
              return (
                <li
                  key={`${event.sourceId}-${index}`}
                  className="flex items-center justify-between gap-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm" title={event.label}>
                        {event.label}
                      </p>
                      {meta.chip && (
                        <Link href={meta.chip.href}>
                          <Chip tone={meta.chip.tone}>{meta.chip.label}</Chip>
                        </Link>
                      )}
                    </div>
                    <p className="text-xs capitalize text-ink-faint">
                      {meta.note}
                    </p>
                  </div>
                  <span className="shrink-0">
                    <span
                      className={clsx(
                        'mr-0.5 text-xs',
                        event.direction === 'in'
                          ? 'text-emerald-400'
                          : 'text-ink-faint',
                      )}
                    >
                      {event.direction === 'in' ? '+' : '−'}
                    </span>
                    <Money
                      cents={event.amountCents}
                      currency={currency}
                      tone={event.direction === 'in' ? 'good' : 'neutral'}
                    />
                  </span>
                </li>
              );
            })}

            {earmarkedSales.map((sale) => (
              <li
                key={`earmarked-${sale.id}`}
                className="flex items-center justify-between gap-3 py-2"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p
                      className="truncate text-sm text-ink-muted"
                      title={sale.label}
                    >
                      {sale.label}
                    </p>
                    <Link href="/loans">
                      <Chip tone="warn">to debt</Chip>
                    </Link>
                  </div>
                  <p className="text-xs text-ink-faint">
                    sold for {formatCents(sale.grossCents, currency)}, all of it
                    earmarked for a debt
                  </p>
                </div>
                <Money cents={0} currency={currency} className="shrink-0" />
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

function DayFigure({
  label,
  cents,
  currency,
  tone,
}: {
  label: string;
  cents?: number;
  currency: string;
  tone?: 'good' | 'warn' | 'bad';
}) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-ink-faint">
        {label}
      </p>
      <p
        className={clsx(
          'tabular mt-0.5 text-sm font-semibold',
          tone === 'good' && 'text-emerald-400',
          tone === 'warn' && 'text-amber-400',
          tone === 'bad' && 'text-rose-400',
        )}
      >
        {cents == null ? '—' : formatCents(cents, currency)}
      </p>
    </div>
  );
}

function ExpenseList({
  expenses,
  currency,
  showMonthlyEquivalent,
}: {
  expenses: Expense[];
  currency: string;
  /** Set for cadences whose face value says little about the monthly cost. */
  showMonthlyEquivalent?: boolean;
}) {
  const { run, pending } = useAction();
  const [editing, setEditing] = useState<Expense | null>(null);

  if (expenses.length === 0)
    return <EmptyState message="No spending recorded yet." />;

  return (
    <>
      <ul className="divide-y divide-border">
        {expenses.map((expense) => (
          <li
            key={expense.id}
            className="flex items-center justify-between gap-3 py-2.5"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm" title={expense.label}>
                  {expense.label}
                </p>
                {expense.linkedLoanId && (
                  <Link href="/loans">
                    <Chip tone="warn">debt</Chip>
                  </Link>
                )}
                {expense.linkedPersonalPlanId && (
                  <Link href="/personal">
                    <Chip tone="good">plan</Chip>
                  </Link>
                )}
                {!expense.active && <Chip>paused</Chip>}
              </div>
              <p className="text-xs text-ink-faint">
                <span className="capitalize">{expense.category}</span>
                {' · '}
                {expense.kind === 'recurring' && expense.recurrence
                  ? describeRecurrence(expense.recurrence)
                  : expense.date
                    ? `once on ${formatDay(expense.date)}`
                    : 'one-off'}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <div className="text-right">
                <Money cents={expense.amountCents} currency={currency} />
                {showMonthlyEquivalent && expense.recurrence && (
                  <p className="tabular text-[11px] text-ink-faint">
                    ≈{' '}
                    {formatCents(
                      monthlyEquivalentCents(
                        expense.amountCents,
                        expense.recurrence,
                      ),
                      currency,
                    )}
                    /mo
                  </p>
                )}
              </div>
              <button
                type="button"
                className="text-[11px] text-ink-faint hover:text-ink"
                onClick={() => setEditing(expense)}
              >
                edit
              </button>
              <button
                type="button"
                className="text-[11px] text-ink-faint hover:text-rose-400"
                disabled={pending}
                onClick={() =>
                  void run(() => api.delete(`/cashflow/expenses/${expense.id}`))
                }
              >
                ✕
              </button>
            </div>
          </li>
        ))}
      </ul>

      {editing && (
        <EditExpenseModal
          expense={editing}
          onClose={() => setEditing(null)}
          currency={currency}
        />
      )}
    </>
  );
}

/**
 * Editing a loan-linked expense here is the same edit as changing the repayment on the debts
 * screen: one row owns the amount (constitution principle IV), which the note spells out.
 */
function EditExpenseModal({
  expense,
  onClose,
  currency,
}: {
  expense: Expense;
  onClose: () => void;
  currency: string;
}) {
  const [amountCents, setAmountCents] = useState<number | undefined>(
    expense.amountCents,
  );
  const [label, setLabel] = useState(expense.label);
  const [currencyValue, setCurrencyValue] = useState(
    expense.currency as Currency,
  );
  const [active, setActive] = useState(expense.active);
  const { run, pending, error } = useAction();

  return (
    <Modal
      open
      onClose={onClose}
      title="Edit spending"
      pending={pending}
      error={error}
      onSubmit={async () => {
        const ok = await run(() =>
          api.patch(`/cashflow/expenses/${expense.id}`, {
            label,
            amountCents,
            currency: currencyValue,
            active,
          }),
        );
        if (ok) onClose();
      }}
    >
      {expense.linkedLoanId && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          This funds a debt repayment. Changing the amount here also changes the
          payoff dates on the Debts screen — it is the same figure, stored once.
        </p>
      )}
      <Field label="Label">
        <Input
          required
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
      </Field>
      <Field label="Amount">
        <MoneyInput
          valueCents={amountCents}
          onChangeCents={setAmountCents}
          currency={currencyValue}
          onChangeCurrency={setCurrencyValue}
        />
      </Field>
      <label className="flex items-center gap-2 text-sm text-ink-muted">
        <input
          type="checkbox"
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
        />
        Include in projections
      </label>
    </Modal>
  );
}

function BalanceModal({
  open,
  onClose,
  today,
  currency,
  currentCents,
  reconciled,
}: {
  open: boolean;
  onClose: () => void;
  today: string;
  currency: string;
  /** Today's projected figure — a starting point to correct, not a recorded fact. */
  currentCents: number;
  reconciled: { cents: number; asOf: string };
}) {
  const [amountCents, setAmountCents] = useState<number | undefined>(
    currentCents,
  );
  const [balanceCurrency, setBalanceCurrency] = useState(currency as Currency);
  const [asOf, setAsOf] = useState(today);
  const { run, pending, error } = useAction();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Update your balance"
      submitLabel="Save balance"
      pending={pending}
      error={error}
      onSubmit={async () => {
        const ok = await run(() =>
          api.put('/cashflow/balance', {
            amountCents,
            currency: balanceCurrency,
            asOf,
          }),
        );
        if (ok) onClose();
      }}
    >
      <p className="text-xs text-ink-muted">
        Enter what is actually in your account. Everything on this page is
        projected forward from this figure and this date.
      </p>
      {reconciled.asOf !== today && (
        <p className="text-xs text-ink-faint">
          You last confirmed {formatCents(reconciled.cents, currency)} on{' '}
          {formatDay(reconciled.asOf)}. The amount below is what the projection
          expects you to have today — correct it if the real figure differs.
        </p>
      )}
      <Field label="Balance">
        <MoneyInput
          required
          valueCents={amountCents}
          onChangeCents={setAmountCents}
          currency={balanceCurrency}
          onChangeCurrency={setBalanceCurrency}
        />
      </Field>
      <Field
        label="True as of"
        hint="Spending since this date is treated as still to come."
      >
        <Input
          type="date"
          required
          value={asOf}
          onChange={(e) => setAsOf(e.target.value)}
        />
      </Field>
    </Modal>
  );
}

function IncomeModal({
  open,
  onClose,
  today,
}: {
  open: boolean;
  onClose: () => void;
  today: string;
}) {
  const defaultCurrency = useDefaultCurrency();
  const [label, setLabel] = useState('');
  const [amountCents, setAmountCents] = useState<number | undefined>(undefined);
  const [currency, setCurrency] = useState<Currency | undefined>(undefined);
  const [dayOfMonth, setDayOfMonth] = useState('7');
  const { run, pending, error } = useAction();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add income"
      submitLabel="Add income"
      pending={pending}
      error={error}
      onSubmit={async () => {
        const ok = await run(() =>
          api.post('/cashflow/incomes', {
            label,
            amountCents,
            currency: currency ?? defaultCurrency,
            recurrence: {
              cadence: 'monthly',
              interval: 1,
              dayOfMonth: Number(dayOfMonth),
              startDate: today,
            },
          }),
        );
        if (ok) onClose();
      }}
    >
      <Field label="Label">
        <Input
          required
          placeholder="EPAM salary"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
      </Field>
      <Field label="Net amount" hint="What actually lands in the account.">
        <MoneyInput
          required
          valueCents={amountCents}
          onChangeCents={setAmountCents}
          currency={currency ?? defaultCurrency}
          onChangeCurrency={setCurrency}
        />
      </Field>
      <Field label="Day of the month">
        <Input
          type="number"
          min="1"
          max="31"
          required
          value={dayOfMonth}
          onChange={(e) => setDayOfMonth(e.target.value)}
        />
      </Field>
    </Modal>
  );
}

/** Which panel's `+` was pressed, so the form opens on the right kind of spending. */
interface ExpensePreset {
  kind: 'recurring' | 'one_off';
  cadence?: Cadence;
  /** For one-offs: a day inside the month being viewed. */
  date?: string;
}

function ExpenseModal({
  preset,
  onClose,
  today,
}: {
  preset: ExpensePreset;
  onClose: () => void;
  today: string;
}) {
  const defaultCurrency = useDefaultCurrency();
  const [form, setForm] = useState({
    label: '',
    amountCents: undefined as number | undefined,
    currency: undefined as Currency | undefined,
    category: 'other',
    kind: preset.kind as string,
    cadence: (preset.cadence ?? 'monthly') as string,
    dayOfMonth: '1',
    date: preset.date ?? today,
  });
  const currency = form.currency ?? defaultCurrency;
  const { run, pending, error } = useAction();

  return (
    <Modal
      open
      onClose={onClose}
      title="Add spending"
      submitLabel="Add spending"
      pending={pending}
      error={error}
      onSubmit={async () => {
        const ok = await run(() =>
          api.post('/cashflow/expenses', {
            label: form.label,
            amountCents: form.amountCents,
            currency,
            category: form.category,
            kind: form.kind,
            recurrence:
              form.kind === 'recurring'
                ? {
                    cadence: form.cadence,
                    interval: 1,
                    dayOfMonth:
                      form.cadence === 'monthly' || form.cadence === 'yearly'
                        ? Number(form.dayOfMonth)
                        : undefined,
                    startDate: today,
                  }
                : undefined,
            date: form.kind === 'one_off' ? form.date : undefined,
          }),
        );
        if (ok) onClose();
      }}
    >
      <Field label="What is it">
        <Input
          required
          placeholder="Rent"
          value={form.label}
          onChange={(e) => setForm({ ...form, label: e.target.value })}
        />
      </Field>
      <Field label="Amount">
        <MoneyInput
          required
          valueCents={form.amountCents}
          onChangeCents={(cents) => setForm({ ...form, amountCents: cents })}
          currency={currency}
          onChangeCurrency={(next) => setForm({ ...form, currency: next })}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Category">
          <Select
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
          >
            {EXPENSE_CATEGORIES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="How often">
          <Select
            value={form.kind}
            onChange={(e) => setForm({ ...form, kind: e.target.value })}
          >
            <option value="recurring">Repeats</option>
            <option value="one_off">Just once</option>
          </Select>
        </Field>
      </div>

      {form.kind === 'recurring' ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Repeats">
            <Select
              value={form.cadence}
              onChange={(e) => setForm({ ...form, cadence: e.target.value })}
            >
              {CASHFLOW_CADENCES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
          </Field>
          {(form.cadence === 'monthly' || form.cadence === 'yearly') && (
            <Field label="Day of month">
              <Input
                type="number"
                min="1"
                max="31"
                value={form.dayOfMonth}
                onChange={(e) =>
                  setForm({ ...form, dayOfMonth: e.target.value })
                }
              />
            </Field>
          )}
        </div>
      ) : (
        <Field label="Date">
          <Input
            type="date"
            required
            value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
          />
        </Field>
      )}
    </Modal>
  );
}
