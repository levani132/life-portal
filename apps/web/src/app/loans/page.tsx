'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useState } from 'react';
import type { LoanDetail, LoanScenario, LoansSummary } from '@life-portal/shared-types';
import { PAYMENT_SOURCES } from '@life-portal/shared-types';
import { formatCents, formatDay, relativeDays } from '@life-portal/shared-domain';
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
  ProgressBar,
  Select,
  Spinner,
  Textarea,
} from '../../components/ui';
import { api } from '../../lib/api';
import { useAction, useApi } from '../../lib/hooks';

interface LoansOverview {
  today: string;
  loans: LoanDetail[];
  summary: LoansSummary;
}

export default function LoansPage() {
  return (
    <AppShell>
      <Loans />
    </AppShell>
  );
}

function Loans() {
  const { data, error, isLoading } = useApi<LoansOverview>('/loans');
  const [addingLoan, setAddingLoan] = useState(false);

  if (isLoading) return <Spinner />;
  if (error) return <ErrorNote message={(error as Error).message} />;
  if (!data) return null;

  return (
    <>
      <PageHeader
        title="Debts"
        subtitle={
          data.summary.activeCount
            ? `${formatCents(data.summary.totalRemainingCents, data.summary.currency)} outstanding across ${data.summary.activeCount} loan${data.summary.activeCount === 1 ? '' : 's'}`
            : 'Nothing outstanding'
        }
        actions={
          <button type="button" className="btn-primary" onClick={() => setAddingLoan(true)}>
            Add a debt
          </button>
        }
      />

      {data.loans.length === 0 ? (
        <EmptyState
          message="No debts recorded."
          action={
            <button type="button" className="btn-primary" onClick={() => setAddingLoan(true)}>
              Add a debt
            </button>
          }
        />
      ) : (
        <div className="space-y-6">
          {data.loans.map((detail) => (
            <LoanBlock key={detail.loan.id} detail={detail} today={data.today} />
          ))}
        </div>
      )}

      <LoanFormModal open={addingLoan} onClose={() => setAddingLoan(false)} today={data.today} />
    </>
  );
}

function LoanBlock({ detail, today }: { detail: LoanDetail; today: string }) {
  const { loan } = detail;
  // An object rather than a boolean so the "record what is missing" prompt can prefill it.
  const [recording, setRecording] = useState<{ amountCents?: number } | null>(null);
  const [addingPlan, setAddingPlan] = useState(false);
  const { run, pending, error } = useAction();
  const currency = loan.currency;

  return (
    <div className="card overflow-hidden">
      <div className="border-b border-border p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold">{loan.lender}</h2>
              <Chip tone={loan.status === 'paid' ? 'good' : detail.behindSchedule ? 'bad' : 'neutral'}>
                {loan.status === 'paid' ? 'repaid' : `priority ${loan.priority}`}
              </Chip>
              {detail.behindSchedule && <Chip tone="bad">behind schedule</Chip>}
              {loan.interestRate > 0 && (
                <Chip tone="warn">{(loan.interestRate * 100).toFixed(2)}% a year</Chip>
              )}
            </div>
            {loan.label && <p className="mt-1 text-sm text-ink-muted">{loan.label}</p>}
          </div>

          <div className="flex items-center gap-2">
            <button type="button" className="btn-ghost" onClick={() => setAddingPlan(true)}>
              Add plan
            </button>
            <button type="button" className="btn-primary" onClick={() => setRecording({})}>
              Record payment
            </button>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Outstanding" value={formatCents(detail.remainingCents, currency)} tone="warn" />
          <Stat label="Repaid" value={formatCents(detail.paidCents, currency)} tone="good" />
          <Stat label="Original" value={formatCents(loan.principalCents, currency)} />
          <Stat
            label="Since"
            value={formatDay(loan.startDate)}
            hint={loan.targetPayoffDate ? `target ${formatDay(loan.targetPayoffDate)}` : undefined}
          />
        </div>

        <div className="mt-4">
          <div className="mb-1.5 flex justify-between text-xs text-ink-faint">
            <span>{Math.round(detail.progressRatio * 100)}% repaid</span>
            <span>
              {formatCents(detail.paidCents, currency)} of {formatCents(loan.principalCents, currency)}
            </span>
          </div>
          <ProgressBar ratio={detail.progressRatio} tone="good" />
        </div>

        {/*
          The budget has already spent these repayments (the linked expense goes out every
          month), so a gap here means the two widgets disagree about the same money. Outstanding
          stays the recorded figure — a plan is an intention, and treating one as history would
          understate a real debt — but the gap is shown rather than left to be discovered.
        */}
        {detail.unrecordedScheduledCents > 0 && (
          <div className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5">
            <p className="text-xs leading-relaxed text-amber-100">
              {detail.unrecordedScheduledCount === 1
                ? 'One scheduled repayment has fallen due'
                : `${detail.unrecordedScheduledCount} scheduled repayments have fallen due`}
              {detail.unrecordedScheduledFromDate
                ? ` since ${formatDay(detail.unrecordedScheduledFromDate)}`
                : ''}{' '}
              with no payment recorded —{' '}
              <span className="font-medium">
                {formatCents(detail.unrecordedScheduledCents, currency)}
              </span>
              . Your budget has already spent that money, so if it went out as planned you owe{' '}
              <span className="font-medium">
                {formatCents(detail.expectedRemainingCents, currency)}
              </span>
              <EstimateMark basis="Outstanding balance minus the scheduled repayments that have fallen due but are not recorded. Recorded payments are the authority; this is what the plan implies." />{' '}
              rather than {formatCents(detail.remainingCents, currency)}.
            </p>
            <button
              type="button"
              className="btn-ghost mt-2 text-xs"
              onClick={() => setRecording({ amountCents: detail.unrecordedScheduledCents })}
            >
              Record {formatCents(detail.unrecordedScheduledCents, currency)} as paid…
            </button>
          </div>
        )}
      </div>

      <div className="grid gap-5 p-5 lg:grid-cols-2">
        <Scenarios scenarios={detail.scenarios} today={today} currency={currency} />

        <div className="space-y-5">
          <Panel title="How this gets repaid" description="Where each repayment is expected to come from.">
            {detail.plans.length === 0 ? (
              <EmptyState message="No repayment plans. Without one there is no payoff date." />
            ) : (
              <ul className="space-y-2">
                {detail.plans.map((plan) => {
                  const inflow = detail.inflows.find((i) => i.planId === plan.id);
                  return (
                    <li
                      key={plan.id}
                      className="flex items-start justify-between gap-3 rounded-lg border border-border px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm">{plan.label}</p>
                        <p className="mt-0.5 text-xs text-ink-faint">
                          {plan.kind === 'recurring' && `monthly on the ${plan.dayOfMonth ?? 1}`}
                          {plan.kind === 'one_off' && plan.date && `once on ${formatDay(plan.date)}`}
                          {plan.kind === 'items' && 'from items earmarked for this debt'}
                          {plan.kind === 'stocks' && 'from shares at their target price'}
                          {plan.linkedExpenseId && (
                            <>
                              {' · '}
                              <Link href="/cashflow" className="text-sky-400 hover:underline">
                                linked to your budget
                              </Link>
                            </>
                          )}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <Money cents={inflow?.amountCents} currency={currency} className="text-sm" />
                        {!plan.guaranteed && (
                          <p className="text-[11px] text-ink-faint">
                            not guaranteed
                            <EstimateMark basis="Depends on a sale happening, so it is excluded from the worst case." />
                          </p>
                        )}
                        <button
                          type="button"
                          className="mt-1 text-[11px] text-ink-faint hover:text-rose-400"
                          disabled={pending}
                          onClick={() => void run(() => api.delete(`/loans/plans/${plan.id}`))}
                        >
                          remove
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {error && <div className="mt-3"><ErrorNote message={error} /></div>}
          </Panel>

          <Panel title="Payment history" description={`${detail.payments.length} recorded`}>
            {detail.payments.length === 0 ? (
              <EmptyState message="No payments recorded yet." />
            ) : (
              <ul className="max-h-72 space-y-1.5 overflow-y-auto">
                {detail.payments.map((payment) => (
                  <li key={payment.id} className="flex items-center justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <span className="text-ink-muted">{formatDay(payment.date)}</span>
                      <span className="ml-2 text-xs text-ink-faint">
                        {payment.source.replace(/_/g, ' ')}
                      </span>
                      {payment.note && (
                        <span className="ml-2 truncate text-xs text-ink-faint">{payment.note}</span>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Money cents={payment.amountCents} currency={currency} tone="good" />
                      <button
                        type="button"
                        className="text-[11px] text-ink-faint hover:text-rose-400"
                        disabled={pending}
                        onClick={() => void run(() => api.delete(`/loans/payments/${payment.id}`))}
                      >
                        ✕
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      {recording && (
        <PaymentModal
          onClose={() => setRecording(null)}
          loanId={loan.id}
          today={today}
          currency={currency}
          maxCents={detail.remainingCents}
          initialAmountCents={recording.amountCents}
        />
      )}
      <PlanModal
        open={addingPlan}
        onClose={() => setAddingPlan(false)}
        loanId={loan.id}
        today={today}
        currency={currency}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: 'good' | 'warn';
  hint?: string;
}) {
  return (
    <div>
      <p
        className={clsx(
          'tabular text-lg font-semibold',
          tone === 'good' && 'text-emerald-400',
          tone === 'warn' && 'text-amber-400',
        )}
      >
        {value}
      </p>
      <p className="text-xs text-ink-faint">{label}</p>
      {hint && <p className="text-[11px] text-ink-faint">{hint}</p>}
    </div>
  );
}

/**
 * The three scenarios side by side.
 *
 * Each one lists what it assumed, because "best case" maximises money recovered and can
 * therefore finish *later* than the realistic case — the assumptions are what make that
 * legible rather than confusing.
 */
function Scenarios({
  scenarios,
  today,
  currency,
}: {
  scenarios: LoanScenario[];
  today: string;
  currency: string;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <Panel title="When this is finished" description="Three ways it could go.">
      <div className="space-y-3">
        {scenarios.map((scenario) => {
          const tone =
            scenario.key === 'worst' ? 'warn' : scenario.key === 'best' ? 'good' : 'neutral';
          const open = expanded === scenario.key;

          return (
            <div key={scenario.key} className="rounded-lg border border-border">
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left"
                onClick={() => setExpanded(open ? null : scenario.key)}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Chip tone={tone}>{scenario.label}</Chip>
                  </div>
                  <p className="mt-1.5 text-sm">
                    {scenario.payoffDate ? (
                      <>
                        <span className="font-medium">{formatDay(scenario.payoffDate)}</span>
                        <span className="ml-2 text-xs text-ink-faint">
                          {relativeDays(today, scenario.payoffDate)}
                          {scenario.monthsToPayoff != null && ` · ${scenario.monthsToPayoff} months`}
                        </span>
                      </>
                    ) : (
                      <span className="text-rose-400">never, on these assumptions</span>
                    )}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-ink-faint">{open ? '▲' : '▼'}</span>
              </button>

              {open && (
                <div className="border-t border-border px-3 py-3">
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-faint">
                    Assuming
                  </p>
                  <ul className="mb-3 space-y-1">
                    {scenario.assumptions.map((line, index) => (
                      <li key={index} className="text-xs text-ink-muted">
                        • {line}
                      </li>
                    ))}
                  </ul>

                  {scenario.steps.length > 0 && (
                    <>
                      <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-ink-faint">
                        Payments
                      </p>
                      <ul className="max-h-56 space-y-1 overflow-y-auto">
                        {scenario.steps.map((step) => (
                          <li key={step.date} className="flex justify-between gap-2 text-xs">
                            <span className="text-ink-muted">{formatDay(step.date)}</span>
                            <span className="flex-1 truncate text-ink-faint">
                              {step.contributions.map((c) => c.label).join(', ')}
                            </span>
                            <Money cents={step.paidCents} currency={currency} />
                            <span className="w-20 text-right text-ink-faint tabular">
                              {formatCents(step.remainingCents, currency)} left
                            </span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

// ------------------------------------------------------------------ modals

function LoanFormModal({
  open,
  onClose,
  today,
}: {
  open: boolean;
  onClose: () => void;
  today: string;
}) {
  const [form, setForm] = useState({
    lender: '',
    label: '',
    principalCents: undefined as number | undefined,
    startDate: today,
    targetPayoffDate: '',
    interestPct: '0',
    priority: '1',
    notes: '',
  });
  const { run, pending, error } = useAction();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a debt"
      submitLabel="Add debt"
      pending={pending}
      error={error}
      onSubmit={async () => {
        const ok = await run(() =>
          api.post('/loans', {
            lender: form.lender,
            label: form.label || undefined,
            principalCents: form.principalCents ?? 0,
            startDate: form.startDate,
            targetPayoffDate: form.targetPayoffDate || undefined,
            interestRate: Number(form.interestPct) / 100,
            priority: Number(form.priority),
            notes: form.notes || undefined,
          }),
        );
        if (ok) onClose();
      }}
    >
      <Field label="Who you owe">
        <Input
          required
          placeholder="A friend's name"
          value={form.lender}
          onChange={(e) => setForm({ ...form, lender: e.target.value })}
        />
      </Field>
      <Field label="Description">
        <Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
      </Field>
      <Field label="Amount borrowed" hint="The original amount, not what is left.">
        <MoneyInput
          required
          valueCents={form.principalCents}
          onChangeCents={(cents) => setForm({ ...form, principalCents: cents })}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Borrowed on">
          <Input
            type="date"
            required
            value={form.startDate}
            onChange={(e) => setForm({ ...form, startDate: e.target.value })}
          />
        </Field>
        <Field label="Hope to clear by">
          <Input
            type="date"
            value={form.targetPayoffDate}
            onChange={(e) => setForm({ ...form, targetPayoffDate: e.target.value })}
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Interest % a year" hint="0 for a loan from a friend.">
          <Input
            type="number"
            min="0"
            step="0.01"
            value={form.interestPct}
            onChange={(e) => setForm({ ...form, interestPct: e.target.value })}
          />
        </Field>
        <Field label="Priority" hint="1 = clear this first.">
          <Input
            type="number"
            min="1"
            value={form.priority}
            onChange={(e) => setForm({ ...form, priority: e.target.value })}
          />
        </Field>
      </div>
      <Field label="Notes">
        <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      </Field>
    </Modal>
  );
}

function PaymentModal({
  onClose,
  loanId,
  today,
  currency,
  maxCents,
  initialAmountCents,
}: {
  onClose: () => void;
  loanId: string;
  today: string;
  currency: string;
  maxCents: number;
  /** Prefilled when the user is recording repayments the plan says already went out. */
  initialAmountCents?: number;
}) {
  const [amountCents, setAmountCents] = useState<number | undefined>(initialAmountCents);
  const [date, setDate] = useState(today);
  const [source, setSource] = useState('salary');
  const [note, setNote] = useState('');
  const { run, pending, error } = useAction();

  return (
    <Modal
      open
      onClose={onClose}
      title="Record a payment"
      submitLabel="Record payment"
      pending={pending}
      error={error}
      onSubmit={async () => {
        const ok = await run(() =>
          api.post(`/loans/${loanId}/payments`, {
            amountCents,
            date,
            source,
            note: note || undefined,
          }),
        );
        if (ok) {
          setAmountCents(undefined);
          setNote('');
          onClose();
        }
      }}
    >
      <Field
        label="Amount"
        hint={`${formatCents(maxCents, currency)} outstanding. Paying more than that just clears the debt.`}
      >
        <MoneyInput required valueCents={amountCents} onChangeCents={setAmountCents} currency={currency} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date">
          <Input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Where it came from">
          <Select value={source} onChange={(e) => setSource(e.target.value)}>
            {PAYMENT_SOURCES.map((option) => (
              <option key={option} value={option}>
                {option.replace(/_/g, ' ')}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Note">
        <Input value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </Modal>
  );
}

function PlanModal({
  open,
  onClose,
  loanId,
  today,
  currency,
}: {
  open: boolean;
  onClose: () => void;
  loanId: string;
  today: string;
  currency: string;
}) {
  const [kind, setKind] = useState('recurring');
  const [label, setLabel] = useState('');
  const [amountCents, setAmountCents] = useState<number | undefined>(undefined);
  const [dayOfMonth, setDayOfMonth] = useState('7');
  const [date, setDate] = useState(today);
  const [createLinkedExpense, setCreateLinkedExpense] = useState(true);
  const { run, pending, error } = useAction();

  const derived = kind === 'items' || kind === 'stocks';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a repayment plan"
      submitLabel="Add plan"
      pending={pending}
      error={error}
      onSubmit={async () => {
        const ok = await run(() =>
          api.post(`/loans/${loanId}/plans`, {
            kind,
            label:
              label ||
              (kind === 'items'
                ? 'Proceeds from items sold'
                : kind === 'stocks'
                  ? 'Proceeds from shares sold'
                  : 'From monthly salary'),
            amountCents: derived ? undefined : amountCents,
            cadence: kind === 'recurring' ? 'monthly' : undefined,
            dayOfMonth: kind === 'recurring' ? Number(dayOfMonth) : undefined,
            startDate: kind === 'recurring' ? today : undefined,
            date: kind === 'one_off' ? date : undefined,
            createLinkedExpense: kind === 'recurring' ? createLinkedExpense : undefined,
          }),
        );
        if (ok) onClose();
      }}
    >
      <Field label="Kind">
        <Select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="recurring">Every month, from salary</option>
          <option value="one_off">One payment on a date</option>
          <option value="items">Whatever the items sell for</option>
          <option value="stocks">Whatever the shares are worth at target</option>
        </Select>
      </Field>

      <Field label="Label">
        <Input
          placeholder={
            kind === 'items'
              ? 'Proceeds from items sold'
              : kind === 'stocks'
                ? 'Proceeds from shares sold'
                : 'From monthly salary'
          }
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
      </Field>

      {derived ? (
        <p className="rounded-lg border border-border px-3 py-2 text-xs text-ink-muted">
          The amount is worked out from the{' '}
          {kind === 'items' ? 'items you have earmarked for this debt' : 'share lots earmarked for this debt, at their target price'}
          , so it stays correct as things change.
        </p>
      ) : (
        <Field label="Amount">
          <MoneyInput
            required
            valueCents={amountCents}
            onChangeCents={setAmountCents}
            currency={currency}
          />
        </Field>
      )}

      {kind === 'recurring' && (
        <>
          <Field label="Day of the month" hint="Your salary lands on the 7th.">
            <Input
              type="number"
              min="1"
              max="31"
              value={dayOfMonth}
              onChange={(e) => setDayOfMonth(e.target.value)}
            />
          </Field>
          <label className="flex items-start gap-2 rounded-lg border border-border px-3 py-2">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={createLinkedExpense}
              onChange={(e) => setCreateLinkedExpense(e.target.checked)}
            />
            <span className="text-xs text-ink-muted">
              Also add this to my budget, so it shows up in Free money and I can adjust the amount
              from either screen.
            </span>
          </label>
        </>
      )}

      {kind === 'one_off' && (
        <Field label="Date">
          <Input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      )}
    </Modal>
  );
}
