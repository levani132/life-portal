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
  CashBalance,
  CashProjection,
  CashflowSummary,
  Expense,
  IncomeSource,
} from '@life-portal/shared-types';
import { CASHFLOW_CADENCES, EXPENSE_CATEGORIES } from '@life-portal/shared-types';
import { describeRecurrence, formatCents, formatDay, relativeDays } from '@life-portal/shared-domain';
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
import { useAction, useApi } from '../../lib/hooks';

interface CashflowOverview {
  today: string;
  summary: CashflowSummary;
  projection: CashProjection;
  incomes: IncomeSource[];
  expenses: Expense[];
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
  const query = snapshotDate ? `/cashflow?snapshotDate=${snapshotDate}` : '/cashflow';
  const { data, error, isLoading } = useApi<CashflowOverview>(query);

  const [editingBalance, setEditingBalance] = useState(false);
  const [addingIncome, setAddingIncome] = useState(false);
  const [addingExpense, setAddingExpense] = useState(false);

  if (isLoading) return <Spinner />;
  if (error) return <ErrorNote message={(error as Error).message} />;
  if (!data) return null;

  const { summary, projection } = data;
  const snapshot = projection.snapshot;

  return (
    <>
      <PageHeader
        title="Free money"
        subtitle={`Balance last reconciled ${formatDay(summary.balanceAsOf)}`}
        actions={
          <>
            <button type="button" className="btn-ghost" onClick={() => setAddingIncome(true)}>
              Add income
            </button>
            <button type="button" className="btn-ghost" onClick={() => setAddingExpense(true)}>
              Add spending
            </button>
            <button type="button" className="btn-primary" onClick={() => setEditingBalance(true)}>
              Update balance
            </button>
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <BigStat
          label="On hand now"
          value={formatCents(summary.currentBalanceCents, summary.currency)}
        />
        <BigStat
          label="Free to spend"
          value={formatCents(summary.freeTodayCents, summary.currency)}
          tone={summary.freeTodayCents < 0 ? 'bad' : summary.freeTodayCents < 20_000 ? 'warn' : 'good'}
          hint="after everything due before payday"
          estimated
        />
        <BigStat
          label="Next salary"
          value={
            summary.nextIncomeDate
              ? formatCents(summary.nextIncomeAmountCents ?? 0, summary.currency)
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
            <ProjectionChart projection={projection} today={data.today} currency={summary.currency} />
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
              Money due <em>on</em> payday is paid from that salary, so it is not counted against
              the balance beforehand. The lowest point between now and then is{' '}
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

          <Panel title="Recurring spending" description={`${data.expenses.length} entries`}>
            <ExpenseList expenses={data.expenses} currency={summary.currency} />
          </Panel>
        </div>

        <div className="space-y-5">
          <Panel title="Income" description="What comes in, and when.">
            {data.incomes.length === 0 ? (
              <EmptyState
                message="No income set up. Add your salary so projections mean something."
                action={
                  <button type="button" className="btn-primary" onClick={() => setAddingIncome(true)}>
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

          <Panel title="Where it goes each month" description="Recurring spending by category.">
            {data.breakdown.length === 0 ? (
              <EmptyState message="No recurring spending recorded." />
            ) : (
              <ul className="space-y-2">
                {data.breakdown.map((row) => {
                  const share = summary.monthlyNetCents
                    ? row.monthlyCents /
                      Math.max(1, data.breakdown.reduce((sum, r) => sum + r.monthlyCents, 0))
                    : 0;
                  return (
                    <li key={row.category}>
                      <div className="mb-1 flex justify-between text-sm">
                        <span className="capitalize text-ink-muted">{row.category}</span>
                        <Money cents={row.monthlyCents} currency={summary.currency} />
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
              <p className="mt-1 text-xs text-ink-faint">{summary.runway.basis}</p>
            </Panel>
          )}
        </div>
      </div>

      <BalanceModal
        open={editingBalance}
        onClose={() => setEditingBalance(false)}
        today={data.today}
        currency={summary.currency}
        currentCents={summary.currentBalanceCents}
      />
      <IncomeModal open={addingIncome} onClose={() => setAddingIncome(false)} today={data.today} />
      <ExpenseModal open={addingExpense} onClose={() => setAddingExpense(false)} today={data.today} />
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
        {estimated && <EstimateMark basis="Projected from your income and planned spending." />}
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

  if (points.length === 0) return <EmptyState message="Nothing to project yet." />;

  return (
    <div className="h-60">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="balanceFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgb(56 189 248)" stopOpacity={0.35} />
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
            labelFormatter={(label) => (typeof label === 'string' ? formatDay(label) : '')}
            formatter={(value) =>
              [formatCents(Math.round(Number(value) * 100), currency), 'Balance'] as [string, string]
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

function IncomeRow({ income, currency }: { income: IncomeSource; currency: string }) {
  const { run, pending } = useAction();
  return (
    <li className="flex items-start justify-between gap-3 rounded-lg border border-border px-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-sm">{income.label}</p>
        <p className="text-xs text-ink-faint">{describeRecurrence(income.recurrence)}</p>
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
          onClick={() => void run(() => api.delete(`/cashflow/incomes/${income.id}`))}
        >
          remove
        </button>
      </div>
    </li>
  );
}

function ExpenseList({ expenses, currency }: { expenses: Expense[]; currency: string }) {
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
                <p className="truncate text-sm">{expense.label}</p>
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
              <Money cents={expense.amountCents} currency={currency} />
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
          api.patch(`/cashflow/expenses/${expense.id}`, { label, amountCents, active }),
        );
        if (ok) onClose();
      }}
    >
      {expense.linkedLoanId && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          This funds a debt repayment. Changing the amount here also changes the payoff dates on
          the Debts screen — it is the same figure, stored once.
        </p>
      )}
      <Field label="Label">
        <Input required value={label} onChange={(e) => setLabel(e.target.value)} />
      </Field>
      <Field label="Amount">
        <MoneyInput valueCents={amountCents} onChangeCents={setAmountCents} currency={currency} />
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
}: {
  open: boolean;
  onClose: () => void;
  today: string;
  currency: string;
  currentCents: number;
}) {
  const [amountCents, setAmountCents] = useState<number | undefined>(currentCents);
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
        const ok = await run(() => api.put('/cashflow/balance', { amountCents, asOf }));
        if (ok) onClose();
      }}
    >
      <p className="text-xs text-ink-muted">
        Enter what is actually in your account. Everything on this page is projected forward from
        this figure and this date.
      </p>
      <Field label="Balance">
        <MoneyInput required valueCents={amountCents} onChangeCents={setAmountCents} currency={currency} />
      </Field>
      <Field label="True as of" hint="Spending since this date is treated as still to come.">
        <Input type="date" required value={asOf} onChange={(e) => setAsOf(e.target.value)} />
      </Field>
    </Modal>
  );
}

function IncomeModal({ open, onClose, today }: { open: boolean; onClose: () => void; today: string }) {
  const [label, setLabel] = useState('');
  const [amountCents, setAmountCents] = useState<number | undefined>(undefined);
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
        <Input required placeholder="EPAM salary" value={label} onChange={(e) => setLabel(e.target.value)} />
      </Field>
      <Field label="Net amount" hint="What actually lands in the account.">
        <MoneyInput required valueCents={amountCents} onChangeCents={setAmountCents} />
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

function ExpenseModal({ open, onClose, today }: { open: boolean; onClose: () => void; today: string }) {
  const [form, setForm] = useState({
    label: '',
    amountCents: undefined as number | undefined,
    category: 'other',
    kind: 'recurring',
    cadence: 'monthly',
    dayOfMonth: '1',
    date: today,
  });
  const { run, pending, error } = useAction();

  return (
    <Modal
      open={open}
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
            category: form.category,
            kind: form.kind,
            recurrence:
              form.kind === 'recurring'
                ? {
                    cadence: form.cadence,
                    interval: 1,
                    dayOfMonth: form.cadence === 'monthly' || form.cadence === 'yearly'
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
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Category">
          <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
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
            <Select value={form.cadence} onChange={(e) => setForm({ ...form, cadence: e.target.value })}>
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
