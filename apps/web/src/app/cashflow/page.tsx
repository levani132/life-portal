'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
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
  BudgetProposal,
  Cadence,
  CashBalance,
  CashEvent,
  CashProjection,
  CashflowSummary,
  CompletenessGap,
  Currency,
  Expense,
  FxContext,
  IncomeSource,
  LadderRung,
  PeriodSaving,
  RealisedSale,
  SavingsBreakdown,
  SpendDayView,
  SpendLadder,
  SpendPayment,
} from '@life-portal/shared-types';
import { CASHFLOW_CADENCES, EXPENSE_CATEGORIES } from '@life-portal/shared-types';
import {
  addDays,
  addMonths,
  describeRecurrence,
  formatCents,
  formatCentsCompact,
  formatDay,
  formatMonth,
  isNewLineProposal,
  localDay,
  monthlyEquivalentCents,
  relativeDays,
  salesOnDay,
  snapshotAt,
  sumCents,
  toDisplayCents,
} from '@life-portal/shared-domain';
import { AppShell, PageHeader } from '../../components/app-shell';
import { PaymentSheet, type SheetPayment } from '../../components/payment-sheet';
import {
  MissingPanel,
  PaymentsPanel,
  decisionChip,
  timeOf,
  type OrphanedAllocation,
} from '../../components/payments-panel';
import { SortableGrid } from '../../components/sortable-grid';
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
  ProgressBar,
  Select,
  Spinner,
} from '../../components/ui';
import { api } from '../../lib/api';
import { revalidate, useAction, useApi, useDefaultCurrency } from '../../lib/hooks';

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
  /** Today's rate table, so mixed-currency rows can be folded into display totals client-side. */
  fx: FxContext;
}

/** Everything the spending side needs in one round trip: ladder, figures, payments, gaps. */
interface SpendOverview {
  today: string;
  ladder: SpendLadder;
  todayFigures: {
    spentCents: number;
    savedCents: number;
    extraCents: number;
    netCents: number;
  };
  payments: SheetPayment[];
  unparsedCount: number;
  gaps: CompletenessGap[];
  orphans: OrphanedAllocation[];
  basis: string;
}

interface SavingsView {
  periods: PeriodSaving[];
  cumulative: SavingsBreakdown;
  month: { projectedSavingCents: number; actualSavingCents: number; extraCents: number };
}

const SPENT_VS_PAID_BASIS =
  'What this day consumed, whichever day paid for it: allowance slices landing on this day, ' +
  'plus transfers and one-offs due on it. A lower bound, like everything from captured payments.';

const LOWER_BOUND_BASIS =
  'Counts captured payments only, so it is a lower bound. Cash, a message your phone did not ' +
  'forward, and anything still unread are not in it.';

export default function CashflowPage() {
  return (
    <AppShell>
      <Cashflow />
    </AppShell>
  );
}

function Cashflow() {
  // Which day the spending figures belong to is the spender's, not the server's: resolved on the
  // client after mount, exactly as the food widget does, and sent explicitly.
  const [spendDay, setSpendDay] = useState<string | null>(null);
  useEffect(() => setSpendDay(localDay(new Date())), []);

  const { data, error, isLoading } = useApi<CashflowOverview>('/cashflow');
  const overview = useApi<SpendOverview>(spendDay ? `/spending?today=${spendDay}` : null);
  const savings = useApi<SavingsView>(spendDay ? `/spending/savings?today=${spendDay}` : null);
  const proposals = useApi<{ suggestions: BudgetProposal[] }>(
    spendDay ? `/spending/suggestions?today=${spendDay}` : null,
  );
  const displayCurrency = useDefaultCurrency();

  const [editingBalance, setEditingBalance] = useState(false);
  const [addingIncome, setAddingIncome] = useState(false);
  const [addingExpense, setAddingExpense] = useState<ExpensePreset | null>(null);
  const [sheet, setSheet] = useState<SheetPayment | null>(null);
  const [reordering, setReordering] = useState(false);
  /**
   * The order a drag is producing, per tier. Held per cadence and merged on commit, because
   * `spendOrder` is one flat list across every tier while a drag only rearranges within one.
   */
  const [pendingOrder, setPendingOrder] = useState<Record<string, string[]>>({});

  // A spending write moves both sides of this page: the ladder, and the past days of the cash
  // projection, which now count captured spending. `useAction`'s own revalidation covers the
  // cashflow roots; this covers the /spending queries it does not know about.
  const refreshSpending = () =>
    Promise.all([revalidate('/spending'), revalidate('/cashflow')]) as Promise<unknown>;

  /** Opens the sheet, preferring the overview's copy of the payment — it carries allocations. */
  const openPayment = (payment: SheetPayment) => {
    const enriched = overview.data?.payments.find((row) => row.id === payment.id);
    setSheet(enriched ?? payment);
  };
  const openPaymentId = (paymentId: string) => {
    const found = overview.data?.payments.find((row) => row.id === paymentId);
    if (found) setSheet(found);
  };

  /**
   * Saves the ladder's order. The drag has already moved the bar — this persists it, and the
   * refetch re-derives every projection against the new order, which is the point: reordering
   * re-attributes past days too.
   */
  const saveOrder = async (order: string[]) => {
    await api.put('/spending/order', { order });
    await refreshSpending();
  };
  const commitOrder = (cadence: Cadence, order: string[]) => {
    const merged = { ...pendingOrder, [cadence]: order };
    // Tiers are walked in the order the ladder reports them, so the flat list keeps daily
    // before weekly before monthly — which is also the cascade's order.
    const flat = (overview.data?.ladder.tiers ?? []).flatMap(
      (tier) => merged[tier.cadence] ?? tier.rungs.map((rung) => rung.expenseId),
    );
    setPendingOrder(merged);
    void saveOrder(flat);
  };

  // Only block on the very first load: a revalidation after a write must not tear the page
  // down to a spinner and lose every panel's local state.
  if (isLoading && !data) return <Spinner />;
  if (error) return <ErrorNote message={(error as Error).message} />;
  if (!data) return null;

  const { summary, projection } = data;

  // "This financial month" is the monthly budget period running now, not the calendar month.
  const monthPeriod = spendDay
    ? savings.data?.periods.find(
        (period) =>
          period.cadence === 'monthly' && period.from <= spendDay && spendDay <= period.to,
      )
    : undefined;
  const monthWindow = monthPeriod
    ? { from: monthPeriod.from, to: monthPeriod.to }
    : spendDay
      ? {
          from: `${spendDay.slice(0, 7)}-01`,
          to: addDays(addMonths(`${spendDay.slice(0, 7)}-01`, 1), -1),
        }
      : undefined;

  const suggestionByExpense = new Map(
    (proposals.data?.suggestions ?? [])
      .filter((proposal) => !isNewLineProposal(proposal))
      .map((proposal) => [proposal.expenseId, proposal]),
  );
  const newLineProposals = (proposals.data?.suggestions ?? []).filter(isNewLineProposal);

  // Custom-purpose payments and payments with 'extra' allocations — the waterfall's overflow.
  const unplannedPayments = monthWindow
    ? (overview.data?.payments ?? []).filter(
        (payment) =>
          payment.direction === 'out' &&
          payment.status === 'recorded' &&
          payment.day >= monthWindow.from &&
          payment.day <= monthWindow.to &&
          (payment.decision?.kind === 'custom' ||
            (payment.allocations ?? []).some((allocation) => allocation.target === 'extra')),
      )
    : [];

  const monthSaving = savings.data?.month;
  const cumulative = savings.data?.cumulative;

  return (
    <>
      <PageHeader
        title="Free money"
        subtitle={`Balance last reconciled ${formatDay(summary.balanceAsOf)} at ${formatCents(summary.reconciledBalanceCents, summary.currency)}`}
        actions={
          <>
            <button type="button" className="btn-ghost" onClick={() => setAddingIncome(true)}>
              Add income
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setAddingExpense({ kind: 'recurring', cadence: 'monthly' })}
            >
              Add spending
            </button>
            <button type="button" className="btn-primary" onClick={() => setEditingBalance(true)}>
              Update balance
            </button>
          </>
        }
      />

      {overview.error && <ErrorNote message={(overview.error as Error).message} />}

      <div className="mb-6 mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <BigStat
          label="On hand now"
          value={formatCents(summary.currentBalanceCents, summary.currency)}
          hint={
            summary.balanceAsOf === data.today
              ? 'reconciled today'
              : `projected from ${formatCents(summary.reconciledBalanceCents, summary.currency)} on ${formatDay(summary.balanceAsOf)}`
          }
          estimated={
            summary.balanceAsOf !== data.today
              ? 'Projected from your income, planned spending and captured payments.'
              : undefined
          }
        />
        <BigStat
          label="Used against allowances"
          value={
            overview.data
              ? formatCents(overview.data.todayFigures.spentCents, displayCurrency)
              : '—'
          }
          hint="today and the periods running now"
          estimated={overview.data?.basis ?? LOWER_BOUND_BASIS}
        />
        <BigStat
          label="Saved"
          value={monthSaving ? formatCents(monthSaving.actualSavingCents, displayCurrency) : '—'}
          tone={monthSaving ? (monthSaving.actualSavingCents >= 0 ? 'good' : 'bad') : undefined}
          hint={
            cumulative
              ? `${formatCentsCompact(cumulative.totalCents, displayCurrency)} all time · daily ${formatCentsCompact(cumulative.daily, displayCurrency)} · weekly ${formatCentsCompact(cumulative.weekly, displayCurrency)} · monthly ${formatCentsCompact(cumulative.monthly, displayCurrency)}`
              : 'this financial month'
          }
          estimated={LOWER_BOUND_BASIS}
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
          <ChartPanel projection={projection} today={data.today} currency={summary.currency} />

          <DatePanel
            data={data}
            overview={overview.data}
            spendDay={spendDay}
            onOpenPayment={openPayment}
          />
        </div>

        <div className="space-y-5">
          <Panel
            title="Income"
            description={
              summary.nextIncomeDate
                ? `Next salary ${formatCents(summary.nextIncomeAmountCents ?? 0, summary.currency)} on ${formatDay(summary.nextIncomeDate)} · ${relativeDays(data.today, summary.nextIncomeDate)}.`
                : 'What comes in, and when.'
            }
          >
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
                  <IncomeRow key={income.id} income={income} currency={summary.currency} />
                ))}
              </ul>
            )}
          </Panel>

          <CategoryBreakdown
            breakdown={data.breakdown}
            expenses={data.expenses}
            payments={overview.data?.payments}
            monthWindow={monthWindow}
            currency={summary.currency}
            displayCurrency={displayCurrency}
          />

          <PaymentsPanel
            payments={overview.data?.payments}
            displayCurrency={displayCurrency}
            onOpen={openPayment}
            onChanged={refreshSpending}
          />

          <MissingPanel
            unparsedCount={overview.data?.unparsedCount}
            gaps={overview.data?.gaps}
            orphans={overview.data?.orphans}
            displayCurrency={displayCurrency}
            onOpenPaymentId={openPaymentId}
            onChanged={refreshSpending}
          />
        </div>
      </div>

      <RecurringSpending
        expenses={data.expenses}
        currency={summary.currency}
        fx={data.fx}
        displayCurrency={displayCurrency}
        ladder={overview.data?.ladder}
        suggestions={suggestionByExpense}
        reordering={reordering}
        onReorderingChange={setReordering}
        pendingOrder={pendingOrder}
        onOrderChange={(cadence, order) =>
          setPendingOrder((previous) => ({ ...previous, [cadence]: order }))
        }
        onCommitOrder={commitOrder}
        onAdd={(cadence) => setAddingExpense({ kind: 'recurring', cadence })}
        onSuggestionHandled={refreshSpending}
      />

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <OneOffSpending
          expenses={data.expenses}
          today={data.today}
          currency={summary.currency}
          fx={data.fx}
          displayCurrency={displayCurrency}
          extraCents={overview.data?.ladder.extraCents}
          unplannedPayments={unplannedPayments}
          newLineProposals={newLineProposals}
          onOpenPayment={openPayment}
          onSuggestionHandled={refreshSpending}
          onAdd={(date) => setAddingExpense({ kind: 'one_off', date })}
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
      <IncomeModal open={addingIncome} onClose={() => setAddingIncome(false)} today={data.today} />
      {/* Mounted only while open, so each preset starts from a clean form. */}
      {addingExpense && (
        <ExpenseModal
          preset={addingExpense}
          onClose={() => setAddingExpense(null)}
          today={data.today}
        />
      )}
      {sheet && (
        <PaymentSheet
          // Keyed so switching payments starts a fresh form rather than reusing the last one's.
          key={sheet.id}
          payment={sheet}
          ladder={overview.data?.ladder}
          displayCurrency={displayCurrency}
          onClose={() => setSheet(null)}
          onChanged={refreshSpending}
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
  /** The basis behind an estimated figure (principle VI). Absent means recorded. */
  estimated?: string;
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
        {estimated && <EstimateMark basis={estimated} />}
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

/** How far ahead the chart looks. The past always shows from the last reconciliation. */
const CHART_HORIZONS = [
  { label: '1M', months: 1 },
  { label: '3M', months: 3 },
  { label: '6M', months: 6 },
  { label: '1Y', months: 12 },
] as const;

/**
 * The balance line, split at today: solid where the days are history (captured spending and
 * settled lines), dashed where they are still a plan. Sampling keeps a year readable and the
 * DOM small without losing today itself.
 */
function ChartPanel({
  projection,
  today,
  currency,
}: {
  projection: CashProjection;
  today: string;
  currency: string;
}) {
  const [months, setMonths] = useState(3);

  const points = useMemo(() => {
    const horizon = addMonths(today, months);
    const days = projection.days.filter((day) => day.date <= horizon);
    const step = Math.max(1, Math.ceil(days.length / 120));
    return days
      .filter((day, index) => index % step === 0 || day.date === today || index === days.length - 1)
      .map((day) => ({
        date: day.date,
        // Both series carry today's value, so the two halves of the line meet there.
        actual: day.date <= today ? day.closingCents / 100 : null,
        planned: day.date >= today ? day.closingCents / 100 : null,
      }));
  }, [projection.days, today, months]);

  return (
    <Panel
      title="What happens to your money"
      description={`Balance day by day — actual from ${formatDay(projection.from)}, planned from today.`}
      actions={
        <div className="flex gap-1">
          {CHART_HORIZONS.map((option) => (
            <button
              key={option.label}
              type="button"
              className={clsx(
                'rounded-full border px-2 py-0.5 text-[11px] transition',
                option.months === months
                  ? 'border-sky-500/50 bg-sky-500/10 text-sky-200'
                  : 'border-border text-ink-muted hover:border-ink-faint hover:text-ink',
              )}
              onClick={() => setMonths(option.months)}
            >
              {option.label}
            </button>
          ))}
        </div>
      }
    >
      {points.length === 0 ? (
        <EmptyState message="Nothing to project yet." />
      ) : (
        <>
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={points} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="actualFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="rgb(56 189 248)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="rgb(56 189 248)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="plannedFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="rgb(56 189 248)" stopOpacity={0.15} />
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
                {/* Today: where recorded days end and the plan begins. */}
                <ReferenceLine
                  x={today}
                  stroke="rgb(106 114 130)"
                  strokeDasharray="4 4"
                  label={{
                    value: 'today',
                    position: 'insideTopRight',
                    fill: 'rgb(106 114 130)',
                    fontSize: 10,
                  }}
                />
                <Tooltip
                  contentStyle={{
                    background: 'rgb(22 25 34)',
                    border: '1px solid rgb(40 45 58)',
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  labelFormatter={(label) => (typeof label === 'string' ? formatDay(label) : '')}
                  formatter={(value, name) =>
                    [
                      formatCents(Math.round(Number(value) * 100), currency),
                      name === 'actual' ? 'Actual' : 'Planned',
                    ] as [string, string]
                  }
                />
                <Area
                  type="monotone"
                  dataKey="actual"
                  stroke="rgb(56 189 248)"
                  strokeWidth={2}
                  fill="url(#actualFill)"
                />
                <Area
                  type="monotone"
                  dataKey="planned"
                  stroke="rgb(56 189 248)"
                  strokeWidth={2}
                  strokeDasharray="5 4"
                  strokeOpacity={0.8}
                  fill="url(#plannedFill)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-faint">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-5 shrink-0 rounded bg-sky-400" aria-hidden />
              actual — captured spending and settled lines
            </span>
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block w-5 shrink-0 border-t-2 border-dashed border-sky-400/80"
                aria-hidden
              />
              planned — from your budgets
            </span>
          </p>
        </>
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
    chip: event.linkedLoanId ? { label: 'debt', href: '/loans', tone: 'warn' } : undefined,
  };
}

/**
 * One date in full: the three planning numbers, what the balance does across the day, and
 * everything that lands on it.
 *
 * Past dates are allowed down to the last reconciliation, and read differently on purpose: a
 * past day's outflow is the payments that were actually captured (plus the manual and one-off
 * lines actuals never displace), while today and later show the plan. The numbers come from the
 * same projection the API serves; `snapshotAt` is the same pure function it calls, so nothing
 * here can diverge from the server.
 */
function DatePanel({
  data,
  overview,
  spendDay,
  onOpenPayment,
}: {
  data: CashflowOverview;
  overview?: SpendOverview;
  spendDay: string | null;
  onOpenPayment: (payment: SheetPayment) => void;
}) {
  const { projection, summary } = data;
  const [date, setDate] = useState(data.today);

  const snapshot = useMemo(
    () => snapshotAt(projection, date, data.today),
    [projection, date, data.today],
  );
  const day = projection.days.find((row) => row.date === date);
  const isPast = date < data.today;

  // Past days inside the overview's 30-day window reuse its payments (allocations included);
  // older days are one fetch, made only when such a day is actually picked.
  const windowStart = spendDay ? addDays(spendDay, -30) : null;
  const inWindow = windowStart != null && date >= windowStart;
  const dayQuery = useApi<SpendPayment[]>(
    isPast && !inWindow ? `/spending/payments?from=${date}&to=${date}` : null,
  );
  const captured: SheetPayment[] = isPast
    ? (inWindow
        ? (overview?.payments ?? []).filter((payment) => payment.day === date)
        : (dayQuery.data ?? [])
      ).filter((payment) => payment.status === 'recorded')
    : [];

  // The allowance view of the same day: what was spent on it, whichever day paid for it.
  // A payment spread across four breakfasts pays once and spends four times, so this is a
  // different number from the projection's out.
  const dayView = useApi<SpendDayView>(`/spending/day?date=${date}`);
  const slices = dayView.data?.slices ?? [];

  const events = day?.events ?? [];
  // On a past day the card allowances have been replaced by what was captured, so only the
  // budget lines actuals can never displace — manual settlements and one-off facts — still list.
  const listedEvents = isPast
    ? events.filter(
        (event) =>
          event.direction === 'in' ||
          event.sourceKind !== 'expense' ||
          event.settlement === 'manual' ||
          event.expenseKind === 'one_off',
      )
    : events;

  // Sales whose proceeds are wholly earmarked never become cash, so they are not cash events —
  // but they did happen on this day, and hiding them would look like nothing happened.
  const earmarkedSales = useMemo(
    () => salesOnDay(data.sales ?? [], date).filter((sale) => sale.amountCents <= 0),
    [data.sales, date],
  );

  // Manual settlements and one-offs are spending on their day even though no message captures
  // them; a future day's are still only plans, so they join the figure once the day has come.
  const uncapturedSpentCents = sumCents(
    (date <= data.today ? events : [])
      .filter(
        (event) =>
          event.direction === 'out' &&
          event.sourceKind === 'expense' &&
          (event.settlement === 'manual' || event.expenseKind === 'one_off'),
      )
      .map((event) => event.amountCents),
  );
  const spentCents =
    dayView.data == null ? undefined : dayView.data.spentCents + uncapturedSpentCents;

  const nothingListed =
    captured.length === 0 &&
    listedEvents.length === 0 &&
    earmarkedSales.length === 0 &&
    slices.length === 0;

  return (
    <Panel
      title="On a specific date"
      description="What you have then, what lands that day, and what is genuinely free."
      actions={
        <Input
          type="date"
          className="w-auto"
          value={date}
          min={projection.from}
          max={projection.to}
          onChange={(event) => setDate(event.target.value || data.today)}
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

      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-4 sm:grid-cols-5">
        <DayFigure label="Opening" cents={day?.openingCents} currency={summary.currency} />
        <DayFigure
          label="In"
          cents={day?.inCents}
          currency={summary.currency}
          tone={day?.inCents ? 'good' : undefined}
        />
        <DayFigure
          label="Paid out"
          cents={day?.outCents}
          currency={summary.currency}
          tone={day?.outCents ? 'warn' : undefined}
          estimated={isPast ? LOWER_BOUND_BASIS : undefined}
        />
        <DayFigure
          label="Spent"
          cents={spentCents}
          currency={summary.currency}
          tone={spentCents ? 'warn' : undefined}
          estimated={SPENT_VS_PAID_BASIS}
        />
        <DayFigure
          label="Closing"
          cents={day?.closingCents}
          currency={summary.currency}
          tone={day && day.closingCents < 0 ? 'bad' : undefined}
        />
      </div>

      {spentCents != null && day != null && spentCents !== day.outCents && (
        <p className="mt-2 text-[11px] text-ink-faint">
          Paid and spent differ when a payment covers other days — milk bought once spends across
          every breakfast it covers, and yesterday&rsquo;s shopping can be today&rsquo;s spending.
        </p>
      )}

      <p className="mt-4 text-xs text-ink-faint">
        Money due <em>on</em> payday is paid from that salary, so it is not counted against the
        balance beforehand. The lowest point between now and then is{' '}
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

      <div className="mt-4 border-t border-border pt-3">
        <p className="mb-1 text-[11px] uppercase tracking-wide text-ink-faint">{formatDay(date)}</p>

        {isPast && (
          <p className="mb-2 text-xs text-ink-faint">
            A past day&rsquo;s card allowances are replaced by the payments actually captured, so
            the recurring card budgets are not listed here.
          </p>
        )}

        {dayQuery.isLoading && (
          <p className="py-2 text-xs text-ink-faint">Fetching what was captured…</p>
        )}

        {slices.length > 0 && (
          <>
            <p className="mb-1 mt-1 text-[11px] uppercase tracking-wide text-ink-faint">
              Spent this day
            </p>
            <ul className="mb-3 divide-y divide-border">
              {slices.map((slice, index) => {
                const source = (overview?.payments ?? []).find(
                  (payment) => payment.id === slice.paymentId,
                );
                const crossDay = slice.paidDay !== date;
                const chip =
                  slice.decided === 'confirmed'
                    ? { label: 'confirmed', tone: 'good' as const }
                    : slice.decided === 'custom'
                      ? { label: 'own purpose', tone: 'good' as const }
                      : { label: 'projected', tone: 'neutral' as const };
                const body = (
                  <>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm" title={slice.label}>
                          {slice.target === 'extra' ? 'Unplanned' : slice.label}
                        </p>
                        <Chip tone={chip.tone}>{chip.label}</Chip>
                      </div>
                      <p className="text-xs text-ink-faint">
                        {crossDay
                          ? `from ${slice.merchant ?? 'a payment'} · paid ${formatDay(slice.paidDay)}`
                          : (slice.merchant ?? 'entered by hand')}
                      </p>
                    </div>
                    <span className="shrink-0">
                      <span className="mr-0.5 text-xs text-ink-faint">−</span>
                      <Money cents={slice.amountCents} currency={summary.currency} />
                    </span>
                  </>
                );
                return (
                  <li key={`${slice.paymentId}-${index}`}>
                    {source ? (
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-3 py-2 text-left"
                        onClick={() => onOpenPayment(source)}
                      >
                        {body}
                      </button>
                    ) : (
                      <div className="flex items-center justify-between gap-3 py-2">{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="mb-1 text-[11px] uppercase tracking-wide text-ink-faint">
              Paid or planned this day
            </p>
          </>
        )}

        {nothingListed && !dayQuery.isLoading ? (
          <p className="py-2 text-xs text-ink-faint">
            {isPast
              ? 'Nothing on this date — no captured payment, no salary, no one-off, nothing sold.'
              : 'Nothing on this date — no salary, no recurring payment, no one-off, nothing sold.'}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {captured.map((payment) => {
              const chip = decisionChip(payment);
              return (
                <li key={payment.id}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 py-2 text-left"
                    onClick={() => onOpenPayment(payment)}
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm">
                          {payment.merchant ?? 'No merchant given'}
                        </p>
                        {payment.direction === 'in' && <Chip tone="good">money in</Chip>}
                        {chip && <Chip tone={chip.tone}>{chip.label}</Chip>}
                      </div>
                      <p className="text-xs text-ink-faint">captured · {timeOf(payment.at)}</p>
                    </div>
                    <span className="shrink-0">
                      <span
                        className={clsx(
                          'mr-0.5 text-xs',
                          payment.direction === 'in' ? 'text-emerald-400' : 'text-ink-faint',
                        )}
                      >
                        {payment.direction === 'in' ? '+' : '−'}
                      </span>
                      <Money
                        cents={payment.amountCents}
                        currency={payment.currency}
                        tone={payment.direction === 'in' ? 'good' : 'neutral'}
                      />
                    </span>
                  </button>
                </li>
              );
            })}

            {listedEvents.map((event, index) => {
              const meta = eventMeta(event, {
                expenses: data.expenses,
                incomes: data.incomes,
                sales: data.sales ?? [],
              });
              const statusChip =
                event.sourceKind === 'expense'
                  ? isPast && event.expenseKind === 'one_off'
                    ? { label: 'recorded', tone: 'neutral' as const }
                    : { label: 'planned', tone: 'neutral' as const }
                  : undefined;
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
                      {statusChip && <Chip tone={statusChip.tone}>{statusChip.label}</Chip>}
                      {meta.chip && (
                        <Link href={meta.chip.href}>
                          <Chip tone={meta.chip.tone}>{meta.chip.label}</Chip>
                        </Link>
                      )}
                    </div>
                    <p className="text-xs capitalize text-ink-faint">{meta.note}</p>
                  </div>
                  <span className="shrink-0">
                    <span
                      className={clsx(
                        'mr-0.5 text-xs',
                        event.direction === 'in' ? 'text-emerald-400' : 'text-ink-faint',
                      )}
                    >
                      {event.direction === 'in' ? '+' : '−'}
                    </span>
                    <Money
                      cents={event.amountCents}
                      currency={summary.currency}
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
                    <p className="truncate text-sm text-ink-muted" title={sale.label}>
                      {sale.label}
                    </p>
                    <Link href="/loans">
                      <Chip tone="warn">to debt</Chip>
                    </Link>
                  </div>
                  <p className="text-xs text-ink-faint">
                    sold for {formatCents(sale.grossCents, summary.currency)}, all of it earmarked
                    for a debt
                  </p>
                </div>
                <Money cents={0} currency={summary.currency} className="shrink-0" />
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
  estimated,
}: {
  label: string;
  cents?: number;
  currency: string;
  tone?: 'good' | 'warn' | 'bad';
  estimated?: string;
}) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-ink-faint">{label}</p>
      <p
        className={clsx(
          'tabular mt-0.5 text-sm font-semibold',
          tone === 'good' && 'text-emerald-400',
          tone === 'warn' && 'text-amber-400',
          tone === 'bad' && 'text-rose-400',
        )}
      >
        {cents == null ? '—' : formatCents(cents, currency)}
        {cents != null && estimated && <EstimateMark basis={estimated} />}
      </p>
    </div>
  );
}

/**
 * Planned versus actual, per category: the recurring plan as the wide bar, and what captured
 * payments actually consumed this financial month as the thin amber bar beneath it. Both bars
 * share one scale — the plan's total — so length means the same thing on every row.
 */
function CategoryBreakdown({
  breakdown,
  expenses,
  payments,
  monthWindow,
  currency,
  displayCurrency,
}: {
  breakdown: { category: string; monthlyCents: number }[];
  expenses: Expense[];
  payments?: SheetPayment[];
  monthWindow?: { from: string; to: string };
  currency: string;
  displayCurrency: string;
}) {
  const actual = useMemo(() => {
    const categoryOf = new Map(expenses.map((expense) => [expense.id, expense.category as string]));
    const byCategory = new Map<string, number>();
    let unplannedCents = 0;
    if (monthWindow) {
      for (const payment of payments ?? []) {
        if (payment.direction === 'in' || payment.status !== 'recorded') continue;
        for (const allocation of payment.allocations ?? []) {
          if (allocation.forDay < monthWindow.from || allocation.forDay > monthWindow.to) continue;
          const category =
            allocation.target === 'expense' && allocation.expenseId
              ? categoryOf.get(allocation.expenseId)
              : undefined;
          if (category) {
            byCategory.set(category, (byCategory.get(category) ?? 0) + allocation.amountCents);
          } else {
            // 'extra' targets, custom purposes and orphaned confirmations all land here.
            unplannedCents += allocation.amountCents;
          }
        }
      }
    }
    return { byCategory, unplannedCents };
  }, [expenses, payments, monthWindow]);

  const plannedTotal = Math.max(
    1,
    breakdown.reduce((sum, row) => sum + row.monthlyCents, 0),
  );

  if (breakdown.length === 0 && actual.unplannedCents === 0) {
    return (
      <Panel title="Where it goes each month" description="Recurring spending by category.">
        <EmptyState message="No recurring spending recorded." />
      </Panel>
    );
  }

  return (
    <Panel
      title="Where it goes each month"
      description="Planned per category, with what was actually spent so far underneath."
    >
      <ul className="space-y-2.5">
        {breakdown.map((row) => (
          <CategoryRow
            key={row.category}
            label={row.category}
            plannedCents={row.monthlyCents}
            actualCents={actual.byCategory.get(row.category) ?? 0}
            plannedTotal={plannedTotal}
            currency={currency}
            displayCurrency={displayCurrency}
          />
        ))}
        {actual.unplannedCents > 0 && (
          <CategoryRow
            label="unplanned"
            plannedCents={null}
            actualCents={actual.unplannedCents}
            plannedTotal={plannedTotal}
            currency={currency}
            displayCurrency={displayCurrency}
          />
        )}
      </ul>
      <p className="mt-3 text-[11px] text-ink-faint">
        Blue is the plan; the thin amber bar is what captured payments consumed this financial month
        <EstimateMark basis={LOWER_BOUND_BASIS} />
      </p>
    </Panel>
  );
}

function CategoryRow({
  label,
  plannedCents,
  actualCents,
  plannedTotal,
  currency,
  displayCurrency,
}: {
  label: string;
  /** Null for the unplanned row, which has no budget by definition. */
  plannedCents: number | null;
  actualCents: number;
  plannedTotal: number;
  currency: string;
  displayCurrency: string;
}) {
  const plannedShare = plannedCents == null ? 0 : plannedCents / plannedTotal;
  const actualShare = Math.min(1, actualCents / plannedTotal);
  return (
    <li>
      <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
        <span className="capitalize text-ink-muted">{label}</span>
        <span className="tabular shrink-0 text-xs">
          <span className="text-ink">
            {formatCents(actualCents, displayCurrency)}
            <EstimateMark basis={LOWER_BOUND_BASIS} />
          </span>
          <span className="text-ink-faint">
            {' '}
            / {plannedCents == null ? 'no plan' : formatCents(plannedCents, currency)}
          </span>
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-border">
        <div
          className="h-full rounded-full bg-sky-500/70"
          style={{ width: `${Math.round(plannedShare * 100)}%` }}
        />
      </div>
      <div className="mt-0.5 h-0.5 overflow-hidden rounded-full bg-border/60">
        <div
          className="h-full rounded-full bg-amber-400/80"
          style={{ width: `${Math.round(actualShare * 100)}%` }}
        />
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

const PERIOD_WORD: Record<Cadence, string> = {
  daily: 'today',
  weekly: 'this week',
  monthly: 'this month',
  yearly: 'this year',
};

/**
 * Paused rows are out of the projection, so they are out of the monthly figure too. Each row is
 * converted into the display currency before it joins the sum — the rows can disagree about
 * their currency, and adding raw lari to raw dollars produced a figure that meant nothing.
 */
function monthlyTotalCents(expenses: Expense[], displayCurrency: string, fx: FxContext): number {
  return sumCents(
    expenses.map((expense) =>
      expense.active && expense.recurrence
        ? toDisplayCents(
            monthlyEquivalentCents(expense.amountCents, expense.recurrence),
            expense.currency,
            fx,
          ).cents
        : 0,
    ),
  );
}

/** Orders rows by a preference list of ids; unknown ids keep their place at the end. */
function sortByPreference(rows: Expense[], preferred: string[]): Expense[] {
  if (preferred.length === 0) return rows;
  const rank = new Map(preferred.map((id, index) => [id, index]));
  return [...rows].sort(
    (a, b) =>
      (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER),
  );
}

/**
 * The recurring panels are also the spending ladder: each row shows how much of its allowance
 * the captured payments have consumed, in the order the cascade fills them — which is why the
 * rows can be dragged: their order *is* the waterfall's order.
 */
function RecurringSpending({
  expenses,
  currency,
  fx,
  displayCurrency,
  ladder,
  suggestions,
  reordering,
  onReorderingChange,
  pendingOrder,
  onOrderChange,
  onCommitOrder,
  onAdd,
  onSuggestionHandled,
}: {
  expenses: Expense[];
  currency: string;
  fx: FxContext;
  displayCurrency: string;
  ladder?: SpendLadder;
  suggestions: Map<string, BudgetProposal>;
  reordering: boolean;
  onReorderingChange: (editing: boolean) => void;
  pendingOrder: Record<string, string[]>;
  onOrderChange: (cadence: Cadence, order: string[]) => void;
  onCommitOrder: (cadence: Cadence, order: string[]) => void;
  onAdd: (cadence: Cadence) => void;
  onSuggestionHandled: () => Promise<unknown>;
}) {
  const [editing, setEditing] = useState<Expense | null>(null);

  const groups = useMemo(() => {
    const buckets = new Map<RecurringGroupKey, Expense[]>();
    for (const expense of expenses) {
      if (expense.kind !== 'recurring') continue;
      const key: RecurringGroupKey = expense.recurrence?.cadence ?? 'unscheduled';
      const bucket = buckets.get(key);
      if (bucket) bucket.push(expense);
      else buckets.set(key, [expense]);
    }
    return buckets;
  }, [expenses]);

  // The malformed-row panel only exists when there is something in it.
  const visible = RECURRING_GROUPS.filter(
    (group) => group.key !== 'unscheduled' || (groups.get('unscheduled')?.length ?? 0) > 0,
  );
  const everything = [...groups.values()].flat();
  const reorderable = ladder != null && ladder.tiers.some((tier) => tier.rungs.length > 1);

  return (
    <section className="mt-5">
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-ink">Recurring spending</h2>
          <p className="mt-0.5 text-xs text-ink-faint">
            One view per cadence. The bars fill as captured payments consume each allowance, in the
            order shown — drag rows to change where money lands first.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {everything.length > 0 && (
            <p className="tabular text-xs text-ink-muted">
              ≈ {formatCents(monthlyTotalCents(everything, currency, fx), currency)}/month in total
              <EstimateMark basis={MONTHLY_EQUIVALENT_BASIS} />
            </p>
          )}
          {reorderable && (
            <button
              type="button"
              className="btn-ghost"
              onClick={() => onReorderingChange(!reordering)}
            >
              {reordering ? 'Done' : 'Arrange'}
            </button>
          )}
        </div>
      </header>

      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {visible.map((group) => {
          const tier = ladder?.tiers.find((row) => row.cadence === group.key);
          const rungById = new Map<string, LadderRung>(
            (tier?.rungs ?? []).map((rung) => [rung.expenseId, rung]),
          );
          const preferred =
            pendingOrder[group.key] ?? tier?.rungs.map((rung) => rung.expenseId) ?? [];
          const rows = sortByPreference(groups.get(group.key) ?? [], preferred);
          const monthlyCents = monthlyTotalCents(rows, currency, fx);
          const renderRow = (expense: Expense) => (
            <ExpenseRow
              expense={expense}
              rung={rungById.get(expense.id)}
              suggestion={suggestions.get(expense.id)}
              currency={currency}
              displayCurrency={displayCurrency}
              showMonthlyEquivalent={group.key !== 'monthly'}
              onEdit={() => setEditing(expense)}
              onSuggestionHandled={onSuggestionHandled}
            />
          );

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
                  {group.key !== 'unscheduled' && tier ? (
                    <SortableGrid
                      items={rows}
                      getId={(expense) => expense.id}
                      getLabel={(expense) => expense.label}
                      editing={reordering}
                      onEditingChange={onReorderingChange}
                      onOrderChange={(order) => onOrderChange(group.key as Cadence, order)}
                      onCommit={(order) => onCommitOrder(group.key as Cadence, order)}
                      className="grid grid-cols-1"
                    >
                      {(expense, state) => (
                        <div
                          className={clsx(
                            state.editing && 'rounded-lg border border-dashed border-border px-2',
                          )}
                        >
                          {renderRow(expense)}
                        </div>
                      )}
                    </SortableGrid>
                  ) : (
                    <ul>
                      {rows.map((expense) => (
                        <li key={expense.id}>{renderRow(expense)}</li>
                      ))}
                    </ul>
                  )}

                  {(tier || monthlyCents > 0) && (
                    <div className="mt-3 space-y-1 border-t border-border pt-3 text-right text-xs">
                      {tier && (
                        <p className="tabular text-ink-muted">
                          spent {formatCents(tier.consumedCents, displayCurrency)} of{' '}
                          {formatCents(tier.budgetCents, displayCurrency)}{' '}
                          {PERIOD_WORD[tier.cadence]}
                          {' · '}
                          <span
                            className={tier.savingCents >= 0 ? 'text-emerald-400' : 'text-rose-400'}
                          >
                            {tier.savingCents >= 0
                              ? `${formatCents(tier.savingCents, displayCurrency)} saved`
                              : `${formatCents(Math.abs(tier.savingCents), displayCurrency)} over`}
                          </span>
                          <EstimateMark basis={LOWER_BOUND_BASIS} />
                        </p>
                      )}
                      {monthlyCents > 0 && (
                        <p className="tabular text-ink-muted">
                          ≈ {formatCents(monthlyCents, currency)}/month
                          <EstimateMark basis={MONTHLY_EQUIVALENT_BASIS} />
                        </p>
                      )}
                    </div>
                  )}
                </>
              )}
            </Panel>
          );
        })}
      </div>

      {editing && (
        <EditExpenseModal expense={editing} onClose={() => setEditing(null)} currency={currency} />
      )}
    </section>
  );
}

/**
 * One recurring line: the expense as the plan states it, and — when the ladder knows it — how
 * much of this period's allowance captured payments have consumed.
 */
function ExpenseRow({
  expense,
  rung,
  suggestion,
  currency,
  displayCurrency,
  showMonthlyEquivalent,
  onEdit,
  onSuggestionHandled,
}: {
  expense: Expense;
  rung?: LadderRung;
  suggestion?: BudgetProposal;
  currency: string;
  displayCurrency: string;
  /** Set for cadences whose face value says little about the monthly cost. */
  showMonthlyEquivalent?: boolean;
  onEdit: () => void;
  onSuggestionHandled: () => Promise<unknown>;
}) {
  const { run, pending } = useAction();
  const manual = rung?.settlement === 'manual';
  const ratio = rung && rung.budgetCents > 0 ? rung.consumedCents / rung.budgetCents : 0;
  const barTone = rung?.confirmed
    ? ('good' as const)
    : manual
      ? ('neutral' as const)
      : ratio > 1
        ? ('bad' as const)
        : ratio > 0.8
          ? ('warn' as const)
          : ('good' as const);

  return (
    <div className="py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
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
            {manual && <Chip>paid by hand</Chip>}
            {rung?.confirmed && <Chip tone="good">settled</Chip>}
          </div>
          <p className="text-xs text-ink-faint">
            <span className="capitalize">{expense.category}</span>
            {' · '}
            {expense.recurrence ? describeRecurrence(expense.recurrence) : 'no schedule'}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <div className="text-right">
            {/* The row's own currency, not the display one: 8.28 lari printed with a dollar
                sign is not a smaller mistake than the wrong number. The converted view lives
                on the rung line below, which is already in the display currency. */}
            <Money cents={expense.amountCents} currency={expense.currency} />
            {showMonthlyEquivalent && expense.recurrence && (
              <p className="tabular text-[11px] text-ink-faint">
                ≈{' '}
                {formatCents(
                  monthlyEquivalentCents(expense.amountCents, expense.recurrence),
                  expense.currency,
                )}
                /mo
              </p>
            )}
          </div>
          <button
            type="button"
            className="text-[11px] text-ink-faint hover:text-ink"
            onClick={onEdit}
          >
            edit
          </button>
          <button
            type="button"
            className="text-[11px] text-ink-faint hover:text-rose-400"
            disabled={pending}
            onClick={() => void run(() => api.delete(`/cashflow/expenses/${expense.id}`))}
          >
            ✕
          </button>
        </div>
      </div>

      {rung && (
        <div className="mt-1.5">
          {/* A manual line is never filled by the cascade, so its bar stays empty until the
              owner confirms something against it. */}
          <ProgressBar ratio={manual && !rung.confirmed ? 0 : ratio} tone={barTone} />
          <p className="tabular mt-1 text-[11px] text-ink-faint">
            {formatCents(rung.consumedCents, displayCurrency)} of{' '}
            {formatCents(rung.budgetCents, displayCurrency)} used
            {manual && !rung.confirmed && ' · settled by hand, never charged by card spending'}
            {rung.confirmed &&
              rung.remainingCents > 0 &&
              ` · ${formatCents(rung.remainingCents, displayCurrency)} saved`}
          </p>
        </div>
      )}

      {suggestion && (
        <SuggestionStrip
          suggestion={suggestion}
          displayCurrency={displayCurrency}
          onHandled={onSuggestionHandled}
        />
      )}
    </div>
  );
}

/**
 * A revised budget the owner's own spending suggests. A proposal only — nothing changes until
 * Accept, and Dismiss records the refused figure so it is not proposed again immediately.
 */
function SuggestionStrip({
  suggestion,
  displayCurrency,
  onHandled,
}: {
  suggestion: BudgetProposal;
  displayCurrency: string;
  onHandled: () => Promise<unknown>;
}) {
  const { run, pending, error } = useAction();
  const act = (verb: 'accept' | 'dismiss') =>
    void run(async () => {
      await api.post(`/spending/suggestions/${encodeURIComponent(suggestion.expenseId)}/${verb}`);
      await onHandled();
    });

  return (
    <div className="mt-1.5 rounded-lg border border-sky-500/30 bg-sky-500/5 px-2.5 py-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-sky-200">
          Suggest {formatCents(suggestion.suggestedCents, displayCurrency)} (was{' '}
          {formatCents(suggestion.currentCents, displayCurrency)})
          <EstimateMark basis={suggestion.basis} />
        </p>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            className="text-[11px] text-sky-300 hover:text-sky-200"
            disabled={pending}
            onClick={() => act('accept')}
          >
            Accept
          </button>
          <button
            type="button"
            className="text-[11px] text-ink-faint hover:text-ink"
            disabled={pending}
            onClick={() => act('dismiss')}
          >
            Dismiss
          </button>
        </div>
      </div>
      {error && <p className="mt-1 text-[11px] text-rose-400">{error}</p>}
    </div>
  );
}

/** One-off spending, one month at a time — the only way a long tail of dated items stays readable. */
function OneOffSpending({
  expenses,
  today,
  currency,
  fx,
  displayCurrency,
  extraCents,
  unplannedPayments,
  newLineProposals,
  onOpenPayment,
  onSuggestionHandled,
  onAdd,
}: {
  expenses: Expense[];
  today: string;
  currency: string;
  fx: FxContext;
  displayCurrency: string;
  /** The ladder's unplanned total for the running month, when the spending side has loaded. */
  extraCents?: number;
  unplannedPayments: SheetPayment[];
  newLineProposals: BudgetProposal[];
  onOpenPayment: (payment: SheetPayment) => void;
  onSuggestionHandled: () => Promise<unknown>;
  /** Called with the first day of the month on screen, so the form opens where you are looking. */
  onAdd: (date: string) => void;
}) {
  const oneOffs = useMemo(
    () =>
      expenses
        .filter((expense) => expense.kind === 'one_off' && Boolean(expense.date))
        .sort((a, b) => ((a.date ?? '') < (b.date ?? '') ? -1 : 1)),
    [expenses],
  );
  const thisMonth = today.slice(0, 7);
  const [month, setMonth] = useState(thisMonth);

  const rows = oneOffs.filter((expense) => expense.date?.startsWith(month));
  // Paused rows are out of the projections, so they stay out of the total too. Each row joins
  // the total in the display currency — the rows can disagree about their own.
  const totalCents = sumCents(
    rows.map((expense) =>
      expense.active ? toDisplayCents(expense.amountCents, expense.currency, fx).cents : 0,
    ),
  );
  const pausedCount = rows.filter((expense) => !expense.active).length;
  const monthsWithEntries = [
    ...new Set(oneOffs.map((expense) => (expense.date ?? '').slice(0, 7))),
  ];

  const shift = (delta: number) => setMonth(addMonths(`${month}-01`, delta).slice(0, 7));

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
      {month === thisMonth && (
        <UnplannedBlock
          extraCents={extraCents}
          payments={unplannedPayments}
          proposals={newLineProposals}
          displayCurrency={displayCurrency}
          onOpenPayment={onOpenPayment}
          onSuggestionHandled={onSuggestionHandled}
        />
      )}

      {rows.length === 0 ? (
        <EmptyState
          message={`Nothing one-off in ${formatMonth(month)}.`}
          action={
            <button type="button" className="btn-ghost" onClick={() => onAdd(`${month}-01`)}>
              Add one
            </button>
          }
        />
      ) : (
        <>
          <ExpenseList expenses={rows} currency={currency} today={today} />
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
          <span className="mr-1 text-[11px] uppercase tracking-wide text-ink-faint">Jump to</span>
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

/**
 * Where the waterfall's overflow lands: spending that exhausted every allowance, plus every
 * custom purpose, with the payments behind the total one tap away. Also where a purpose the
 * owner keeps paying for is offered a budget line of its own.
 */
function UnplannedBlock({
  extraCents,
  payments,
  proposals,
  displayCurrency,
  onOpenPayment,
  onSuggestionHandled,
}: {
  extraCents?: number;
  payments: SheetPayment[];
  proposals: BudgetProposal[];
  displayCurrency: string;
  onOpenPayment: (payment: SheetPayment) => void;
  onSuggestionHandled: () => Promise<unknown>;
}) {
  if (extraCents == null && payments.length === 0 && proposals.length === 0) return null;

  return (
    <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <p className="text-sm font-medium text-ink">Unplanned this month</p>
        <p
          className={clsx(
            'tabular shrink-0 text-sm font-medium',
            (extraCents ?? 0) > 0 ? 'text-amber-400' : 'text-ink-faint',
          )}
        >
          {extraCents == null ? '—' : formatCents(extraCents, displayCurrency)}
          <EstimateMark basis={LOWER_BOUND_BASIS} />
        </p>
      </div>
      <p className="mt-0.5 text-[11px] text-ink-faint">
        Spending that exhausted every allowance, plus anything you gave its own purpose. It sits
        outside the budget rather than being squeezed into a line that was already full.
      </p>

      {payments.length > 0 && (
        <ul className="mt-2 divide-y divide-border">
          {payments.map((payment) => (
            <li key={payment.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 py-1.5 text-left"
                onClick={() => onOpenPayment(payment)}
              >
                <span className="min-w-0 truncate text-xs text-ink-muted">
                  {payment.decision?.kind === 'custom' && payment.decision.purpose
                    ? payment.decision.purpose
                    : (payment.merchant ?? 'No merchant given')}
                  <span className="text-ink-faint"> · {formatDay(payment.day)}</span>
                </span>
                <span className="tabular shrink-0 text-xs text-ink">
                  {formatCents(payment.amountCents, payment.currency)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {proposals.map((proposal) => (
        <NewLineProposalRow
          key={proposal.expenseId}
          proposal={proposal}
          displayCurrency={displayCurrency}
          onHandled={onSuggestionHandled}
        />
      ))}
    </div>
  );
}

const CADENCE_WORD: Record<Cadence, string> = {
  daily: 'day',
  weekly: 'week',
  monthly: 'month',
  yearly: 'year',
};

/**
 * A purpose paid for repeatedly without ever being budgeted. Accepting creates the budget line;
 * there is no dismiss, because a line that does not exist has no row to remember one on — the
 * API answers a dismissal with a 400 for exactly that reason.
 */
function NewLineProposalRow({
  proposal,
  displayCurrency,
  onHandled,
}: {
  proposal: BudgetProposal;
  displayCurrency: string;
  onHandled: () => Promise<unknown>;
}) {
  const { run, pending, error } = useAction();

  return (
    <div className="mt-2 rounded-lg border border-sky-500/30 bg-sky-500/5 px-2.5 py-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-sky-200">
          You keep paying for &ldquo;{proposal.label}&rdquo; — budget{' '}
          {formatCents(proposal.suggestedCents, displayCurrency)}/{CADENCE_WORD[proposal.cadence]}?
          <EstimateMark basis={proposal.basis} />
        </p>
        <button
          type="button"
          className="text-[11px] text-sky-300 hover:text-sky-200"
          disabled={pending}
          onClick={() =>
            void run(async () => {
              await api.post(
                `/spending/suggestions/${encodeURIComponent(proposal.expenseId)}/accept`,
              );
              await onHandled();
            })
          }
        >
          Budget it
        </button>
      </div>
      {error && <p className="mt-1 text-[11px] text-rose-400">{error}</p>}
    </div>
  );
}

function ExpenseList({
  expenses,
  currency,
  today,
}: {
  expenses: Expense[];
  currency: string;
  /** Supplied for one-off lists, where a dated row is a recorded fact or a plan. */
  today?: string;
}) {
  const { run, pending } = useAction();
  const [editing, setEditing] = useState<Expense | null>(null);

  if (expenses.length === 0) return <EmptyState message="No spending recorded yet." />;

  return (
    <>
      <ul className="divide-y divide-border">
        {expenses.map((expense) => (
          <li key={expense.id} className="flex items-center justify-between gap-3 py-2.5">
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
                {today && expense.kind === 'one_off' && expense.date && (
                  <Chip>{expense.date < today ? 'spent' : 'planned'}</Chip>
                )}
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
                <Money cents={expense.amountCents} currency={expense.currency} />
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
                onClick={() => void run(() => api.delete(`/cashflow/expenses/${expense.id}`))}
              >
                ✕
              </button>
            </div>
          </li>
        ))}
      </ul>

      {editing && (
        <EditExpenseModal expense={editing} onClose={() => setEditing(null)} currency={currency} />
      )}
    </>
  );
}

function IncomeRow({ income, currency }: { income: IncomeSource; currency: string }) {
  const { run, pending } = useAction();
  return (
    <li className="flex items-start justify-between gap-3 rounded-lg border border-border px-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-sm">{income.label}</p>
        <p className="text-xs text-ink-faint">{describeRecurrence(income.recurrence)}</p>
      </div>
      <div className="shrink-0 text-right">
        {/* The income's own currency — the salary is genuinely paid in dollars. */}
        <Money cents={income.amountCents} currency={income.currency} tone="good" />
        {income.amountCents === 0 && (
          <p className="text-[11px] text-amber-400">set the real amount</p>
        )}
        <button
          type="button"
          className="mt-0.5 block w-full text-[11px] text-ink-faint hover:text-rose-400"
          disabled={pending}
          onClick={() => void run(() => api.delete(`/cashflow/incomes/${income.id}`))}
        >
          remove
        </button>
      </div>
    </li>
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
  const [amountCents, setAmountCents] = useState<number | undefined>(expense.amountCents);
  const [label, setLabel] = useState(expense.label);
  const [currencyValue, setCurrencyValue] = useState(expense.currency as Currency);
  const [settlement, setSettlement] = useState(expense.settlement ?? 'auto');
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
            settlement,
            active,
          }),
        );
        if (ok) onClose();
      }}
    >
      {expense.linkedLoanId && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          This funds a debt repayment. Changing the amount here also changes the payoff dates on the
          Debts screen — it is the same figure, stored once.
        </p>
      )}
      <Field label="Label">
        <Input required value={label} onChange={(e) => setLabel(e.target.value)} />
      </Field>
      <Field label="Amount">
        <MoneyInput
          valueCents={amountCents}
          onChangeCents={setAmountCents}
          currency={currencyValue}
          onChangeCurrency={setCurrencyValue}
        />
      </Field>
      <Field
        label="How it gets paid"
        hint={
          settlement === 'manual'
            ? 'Counted in the budget, but card spending is never charged against it — you tick it off yourself.'
            : 'Card spending fills this up as it happens.'
        }
      >
        <Select
          value={settlement}
          onChange={(e) => setSettlement(e.target.value as 'auto' | 'manual')}
        >
          <option value="auto">By card</option>
          <option value="manual">By transfer or direct debit</option>
        </Select>
      </Field>
      <label className="flex items-center gap-2 text-sm text-ink-muted">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
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
  const [amountCents, setAmountCents] = useState<number | undefined>(currentCents);
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
        Enter what is actually in your account. Everything on this page is projected forward from
        this figure and this date.
      </p>
      {reconciled.asOf !== today && (
        <p className="text-xs text-ink-faint">
          You last confirmed {formatCents(reconciled.cents, currency)} on{' '}
          {formatDay(reconciled.asOf)}. The amount below is what the projection expects you to have
          today — correct it if the real figure differs.
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
      <Field label="True as of" hint="Spending since this date is treated as still to come.">
        <Input type="date" required value={asOf} onChange={(e) => setAsOf(e.target.value)} />
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
          <Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
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
                onChange={(e) => setForm({ ...form, dayOfMonth: e.target.value })}
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
