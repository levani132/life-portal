'use client';

import clsx from 'clsx';
import { useState } from 'react';
import type {
  Cadence,
  Currency,
  SpendAllocation,
  SpendLadder,
  SpendPayment,
} from '@life-portal/shared-types';
import { CASHFLOW_CADENCES } from '@life-portal/shared-types';
import { formatCents, formatDay } from '@life-portal/shared-domain';
import { api } from '../lib/api';
import { useAction } from '../lib/hooks';
import { Chip, EstimateMark, Field, Input, Modal, MoneyInput, Select } from './ui';

/** A payment as the overview serves it: the row, plus where the waterfall thinks it went. */
export interface SheetPayment extends SpendPayment {
  allocations?: SpendAllocation[];
}

/** What the sheet is currently asking the owner. One question at a time. */
type Mode = 'confirm' | 'custom' | 'promote' | 'repaid';

const MODE_LABEL: Record<Mode, string> = {
  confirm: 'What it was',
  custom: 'Something else',
  promote: 'Budget for it',
  repaid: 'Paid back',
};

const CADENCE_LABEL: Record<Cadence, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  yearly: 'Yearly',
};

interface AllocationRow {
  key: string;
  expenseId: string;
  amountCents?: number;
  /** Blank means "the day the money left", which is what the server assumes. */
  forDay: string;
  throughDay: string;
  /** Whether the day/span inputs are showing. Hidden by default: the common case is one tap. */
  span: boolean;
}

/**
 * The sheet where a payment stops being a guess.
 *
 * Everything the waterfall proposed is shown as a proposal (principle VI). The owner may accept
 * it whole, split it across several allowances, cover only part of it, say it was something else
 * entirely, or say some of the money was never really theirs.
 */
export function PaymentSheet({
  payment,
  ladder,
  displayCurrency,
  onClose,
  onChanged,
}: {
  payment: SheetPayment;
  ladder?: SpendLadder;
  displayCurrency: string;
  onClose: () => void;
  onChanged: () => Promise<unknown>;
}) {
  const rungs = flattenRungs(ladder);
  const spendableCents = Math.max(0, payment.amountCents - (payment.notReallySpentCents ?? 0));
  const decision = payment.decision;

  const [mode, setMode] = useState<Mode>(decision?.kind === 'custom' ? 'custom' : 'confirm');
  const [rows, setRows] = useState<AllocationRow[]>(() =>
    initialRows(payment, spendableCents, displayCurrency),
  );
  const [purpose, setPurpose] = useState(decision?.purpose ?? '');
  const [repaidCents, setRepaidCents] = useState(payment.notReallySpentCents);
  const [promotion, setPromotion] = useState({
    cadence: 'monthly' as Cadence,
    label: decision?.purpose ?? payment.merchant ?? '',
    amountCents: payment.amountCents as number | undefined,
    currency: payment.currency as Currency,
  });
  const { run, pending, error } = useAction();
  /** Complaints about the form itself, which never reach the server. */
  const [notice, setNotice] = useState<string | null>(null);

  const allocatedCents = rows.reduce((sum, row) => sum + (row.amountCents ?? 0), 0);
  const leftoverCents = spendableCents - allocatedCents;
  const orphaned = (payment.allocations ?? []).filter(isOrphan);
  const promotable = decision?.kind === 'custom' && !decision.promotedToExpenseId;

  const submit = async () => {
    let ok = false;
    setNotice(null);
    if (mode === 'confirm') {
      const allocations = rows
        .filter((row) => row.expenseId && (row.amountCents ?? 0) > 0)
        .map((row) => ({
          expenseId: row.expenseId,
          amountCents: row.amountCents as number,
          forDay: row.span && row.forDay ? row.forDay : undefined,
          throughDay:
            row.span && row.throughDay && row.throughDay >= (row.forDay || payment.day)
              ? row.throughDay
              : undefined,
        }));
      if (allocations.length === 0) {
        setNotice('Pick at least one allowance and an amount, or say it was something else.');
        return;
      }
      if (leftoverCents < 0) {
        setNotice('That adds up to more than the payment.');
        return;
      }
      ok = await run(async () => {
        await api.put(`/spending/payments/${payment.id}/decision`, {
          kind: 'confirmed',
          allocations,
        });
        await onChanged();
      });
    } else if (mode === 'custom') {
      ok = await run(async () => {
        await api.put(`/spending/payments/${payment.id}/decision`, {
          kind: 'custom',
          purpose: purpose.trim(),
        });
        await onChanged();
      });
      // Stays open: a purpose worth naming is often a purpose worth budgeting for, and the
      // promote step only becomes available once the purpose exists.
      if (ok) {
        // The purpose the owner just named is the obvious name for the line it would become.
        setPromotion((current) => ({ ...current, label: purpose.trim() || current.label }));
        setMode('promote');
        return;
      }
    } else if (mode === 'promote') {
      ok = await run(async () => {
        await api.post(`/spending/payments/${payment.id}/promote`, {
          cadence: promotion.cadence,
          label: promotion.label.trim(),
          amountCents: promotion.amountCents ?? 0,
          currency: promotion.currency,
        });
        await onChanged();
      });
    } else {
      ok = await run(async () => {
        await api.patch(`/spending/payments/${payment.id}`, {
          notReallySpentCents: repaidCents ?? 0,
        });
        await onChanged();
      });
    }
    if (ok) onClose();
  };

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={payment.merchant ?? 'This payment'}
      submitLabel={SUBMIT_LABEL[mode]}
      pending={pending}
      error={error ?? notice}
      onSubmit={() => void submit()}
    >
      <header className="rounded-lg border border-border bg-surface px-3 py-2.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <p className="tabular text-lg font-semibold text-ink">
            {formatCents(payment.amountCents, payment.currency)}
          </p>
          <p className="shrink-0 text-xs text-ink-faint">
            {formatDay(payment.day)}
            {payment.cardLast4 ? ` · card ••${payment.cardLast4}` : ''}
          </p>
        </div>
        {payment.notReallySpentCents != null && payment.notReallySpentCents > 0 && (
          <p className="tabular mt-0.5 text-[11px] text-ink-faint">
            {formatCents(payment.notReallySpentCents, payment.currency)} of it was paid back, so{' '}
            {formatCents(spendableCents, payment.currency)} counts as spending.
          </p>
        )}
      </header>

      {orphaned.length > 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
          You confirmed this against a budget line that no longer exists, so it is counting as
          unplanned spending until you decide again. Pick a line below, or give it a purpose of its
          own.
        </div>
      )}

      <Decomposition
        allocations={payment.allocations}
        currency={displayCurrency}
        decided={decision?.kind}
      />

      {decision && (
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone="good">
            {decision.kind === 'custom' ? 'given its own purpose' : 'confirmed by you'}
          </Chip>
          <button
            type="button"
            className="text-xs text-ink-faint underline hover:text-ink"
            disabled={pending}
            onClick={() =>
              void run(async () => {
                await api.put(`/spending/payments/${payment.id}/decision`, { kind: 'none' });
                await onChanged();
                onClose();
              })
            }
          >
            Undo — let the app work it out again
          </button>
        </div>
      )}

      <div className="flex flex-wrap gap-1 rounded-lg border border-border p-1 text-sm">
        {(['confirm', 'custom', 'promote', 'repaid'] as Mode[])
          .filter((option) => option !== 'promote' || promotable || mode === 'promote')
          .map((option) => (
            <button
              key={option}
              type="button"
              className={clsx(
                'rounded-md px-2.5 py-1',
                mode === option ? 'bg-surface-raised text-ink' : 'text-ink-muted hover:text-ink',
              )}
              onClick={() => setMode(option)}
            >
              {MODE_LABEL[option]}
            </button>
          ))}
      </div>

      {mode === 'confirm' && (
        <ConfirmForm
          rows={rows}
          setRows={setRows}
          rungs={rungs}
          payment={payment}
          spendableCents={spendableCents}
          leftoverCents={leftoverCents}
        />
      )}

      {mode === 'custom' && (
        <>
          <Field label="What was it, then?" hint="Free text. Nothing reads it but you.">
            <Input
              placeholder="A vase"
              value={purpose}
              onChange={(event) => setPurpose(event.target.value)}
            />
          </Field>
          <p className="text-xs text-ink-faint">
            A purpose of its own consumes no planned allowance: the whole payment counts as
            unplanned spending for the month, and every budget line keeps whatever it had left.
          </p>
        </>
      )}

      {mode === 'promote' && (
        <>
          <p className="text-xs text-ink-muted">
            Turn this into a budget line and future payments can land on it, instead of counting as
            unplanned every time.
          </p>
          <Field label="Call it">
            <Input
              placeholder="Homeware"
              value={promotion.label}
              onChange={(event) => setPromotion({ ...promotion, label: event.target.value })}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="How often">
              <Select
                value={promotion.cadence}
                onChange={(event) =>
                  setPromotion({ ...promotion, cadence: event.target.value as Cadence })
                }
              >
                {CASHFLOW_CADENCES.map((cadence) => (
                  <option key={cadence} value={cadence}>
                    {CADENCE_LABEL[cadence]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="How much each time">
              <MoneyInput
                required
                valueCents={promotion.amountCents}
                onChangeCents={(cents) => setPromotion({ ...promotion, amountCents: cents })}
                currency={promotion.currency}
                onChangeCurrency={(currency) => setPromotion({ ...promotion, currency })}
              />
            </Field>
          </div>
          <p className="text-xs text-ink-faint">
            This creates a cash-flow expense, which is the only place a budget lives. The ladder
            picks it up on the next read.
          </p>
        </>
      )}

      {mode === 'repaid' && (
        <>
          <Field
            label="How much of this was never really yours"
            hint={`In ${payment.currency}. Leave blank if all of it was.`}
          >
            <MoneyInput
              valueCents={repaidCents}
              onChangeCents={setRepaidCents}
              currency={payment.currency}
            />
          </Field>
          <p className="text-xs text-ink-faint">
            A share of a dinner someone sent back, or a refund. It counts as neither spending nor
            consumption, so it uses none of your allowances — only the rest of the payment does.
          </p>
        </>
      )}
    </Modal>
  );
}

const SUBMIT_LABEL: Record<Mode, string> = {
  confirm: 'That was it',
  custom: 'Save purpose',
  promote: 'Create the budget line',
  repaid: 'Save',
};

/**
 * Where the money is currently reckoned to have gone.
 *
 * A projected line is worded as a guess and marked as one; a decided line is not, because by then
 * the owner has said so themselves.
 */
function Decomposition({
  allocations,
  currency,
  decided,
}: {
  allocations?: SpendAllocation[];
  currency: string;
  decided?: string;
}) {
  if (!allocations || allocations.length === 0) {
    return (
      <p className="text-xs text-ink-faint">
        Nothing is counting against an allowance for this payment.
      </p>
    );
  }

  const projected = allocations.some((allocation) => allocation.projected);

  return (
    <div>
      <p className="text-xs text-ink-muted">
        {projected
          ? 'This is where we think it went — the app walked your allowances in order and split it up. Nothing here is a record of what you bought.'
          : decided === 'custom'
            ? 'You gave this its own purpose, so it sits outside the budget.'
            : 'You said this is where it went.'}
      </p>
      <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
        {allocations.map((allocation, index) => (
          <li
            key={`${allocation.expenseId ?? allocation.label}-${allocation.forDay}-${index}`}
            className="flex items-baseline justify-between gap-3 px-3 py-2"
          >
            <div className="min-w-0">
              <p className="truncate text-sm text-ink">
                {allocation.label}
                {allocation.projected && (
                  <EstimateMark basis="Proposed by the waterfall, not confirmed by you. It is recomputed every time this page loads." />
                )}
              </p>
              <p className="text-[11px] text-ink-faint">
                {isOrphan(allocation)
                  ? 'the line it named has since been deleted'
                  : allocation.target === 'extra'
                    ? 'outside every budget line'
                    : `against ${formatDay(allocation.forDay)}’s allowance`}
              </p>
            </div>
            <span className="tabular shrink-0 text-sm text-ink-muted">
              {formatCents(allocation.amountCents, currency)}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-1 text-[11px] text-ink-faint">
        Shown in {currency}, converted at the rate for the day the money left.
      </p>
    </div>
  );
}

function ConfirmForm({
  rows,
  setRows,
  rungs,
  payment,
  spendableCents,
  leftoverCents,
}: {
  rows: AllocationRow[];
  setRows: (rows: AllocationRow[]) => void;
  rungs: FlatRung[];
  payment: SpendPayment;
  spendableCents: number;
  leftoverCents: number;
}) {
  const update = (key: string, patch: Partial<AllocationRow>) =>
    setRows(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  if (rungs.length === 0) {
    return (
      <p className="text-xs text-ink-muted">
        There are no budget lines to confirm against yet. Add one in cash flow, or give this payment
        a purpose of its own.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-muted">
        Say which allowance this really used. Amounts are in {payment.currency}, the currency the
        payment was made in.
      </p>

      {rows.map((row) => (
        <div key={row.key} className="rounded-lg border border-border bg-surface p-3">
          <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr]">
            <Field label="Which allowance">
              <Select
                value={row.expenseId}
                onChange={(event) => update(row.key, { expenseId: event.target.value })}
              >
                <option value="">Pick a line…</option>
                {rungs.map((rung) => (
                  <option key={rung.expenseId} value={rung.expenseId}>
                    {CADENCE_LABEL[rung.cadence]} · {rung.label}
                  </option>
                ))}
                {row.expenseId && !rungs.some((rung) => rung.expenseId === row.expenseId) && (
                  <option value={row.expenseId}>A line that no longer exists</option>
                )}
              </Select>
            </Field>
            <Field label="How much of it">
              <MoneyInput
                valueCents={row.amountCents}
                onChangeCents={(cents) => update(row.key, { amountCents: cents })}
                currency={payment.currency}
              />
            </Field>
          </div>

          {row.span ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="This was for" hint="Bought tonight, eaten tomorrow.">
                <Input
                  type="date"
                  value={row.forDay || payment.day}
                  onChange={(event) => update(row.key, { forDay: event.target.value })}
                />
              </Field>
              <Field label="…through" hint="One carton of milk, four breakfasts.">
                <Input
                  type="date"
                  value={row.throughDay}
                  min={row.forDay || payment.day}
                  onChange={(event) => update(row.key, { throughDay: event.target.value })}
                />
              </Field>
            </div>
          ) : (
            <button
              type="button"
              className="mt-2 text-[11px] text-ink-faint underline hover:text-ink"
              onClick={() => update(row.key, { span: true, forDay: row.forDay || payment.day })}
            >
              It was for another day, or for several
            </button>
          )}

          {rows.length > 1 && (
            <div className="mt-2 flex justify-end">
              <button
                type="button"
                className="text-[11px] text-ink-faint hover:text-rose-400"
                onClick={() => setRows(rows.filter((other) => other.key !== row.key))}
              >
                remove
              </button>
            </div>
          )}
        </div>
      ))}

      <button
        type="button"
        className="btn-ghost"
        onClick={() => setRows([...rows, blankRow(payment.day)])}
      >
        Split across another allowance
      </button>

      <p className={clsx('text-xs', leftoverCents < 0 ? 'text-rose-400' : 'text-ink-faint')}>
        {leftoverCents < 0 ? (
          <>
            That is {formatCents(Math.abs(leftoverCents), payment.currency)} more than the payment.
            Bring it down to {formatCents(spendableCents, payment.currency)} or less.
          </>
        ) : leftoverCents > 0 ? (
          <>
            You are accounting for {formatCents(spendableCents - leftoverCents, payment.currency)}{' '}
            of {formatCents(spendableCents, payment.currency)}. The other{' '}
            {formatCents(leftoverCents, payment.currency)} is left to the app, which will work it
            out the same way it does now.
          </>
        ) : (
          <>The whole payment is accounted for.</>
        )}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ helpers -- */

interface FlatRung {
  expenseId: string;
  label: string;
  cadence: Cadence;
}

function flattenRungs(ladder?: SpendLadder): FlatRung[] {
  if (!ladder) return [];
  return ladder.tiers.flatMap((tier) =>
    tier.rungs.map((rung) => ({
      expenseId: rung.expenseId,
      label: rung.label,
      cadence: tier.cadence,
    })),
  );
}

/**
 * An orphan: confirmed against a line that has since been deleted.
 *
 * The waterfall keeps it rather than dropping it, and marks it by leaving the dead `expenseId` on
 * an allocation that landed outside the budget.
 */
function isOrphan(allocation: SpendAllocation): boolean {
  return allocation.target === 'extra' && allocation.expenseId != null;
}

/**
 * Row keys come from a counter rather than `crypto.randomUUID`, which does not exist outside a
 * secure context — this app is opened over the LAN as often as over https.
 */
let nextKey = 0;
const rowKey = () => `row-${(nextKey += 1)}`;

function blankRow(day: string): AllocationRow {
  return {
    key: rowKey(),
    expenseId: '',
    amountCents: undefined,
    forDay: day,
    throughDay: '',
    span: false,
  };
}

/**
 * Pre-fills the confirm form so the common case — "yes, that is right" — is one tap.
 *
 * A decided payment fills from what the owner said. An undecided one fills from the projection,
 * which arrives in the display currency while a confirmation is validated against the payment's
 * own amount; where they differ the proposal is scaled back proportionally rather than shown as a
 * figure that would be rejected.
 */
function initialRows(
  payment: SheetPayment,
  spendableCents: number,
  displayCurrency: string,
): AllocationRow[] {
  const decided = payment.decision?.kind === 'confirmed' ? payment.decision.allocations : undefined;
  if (decided && decided.length > 0) {
    return decided.map((allocation) => ({
      key: rowKey(),
      expenseId: allocation.expenseId,
      amountCents: allocation.amountCents,
      forDay: allocation.forDay ?? payment.day,
      throughDay: allocation.throughDay ?? '',
      span: allocation.forDay != null || allocation.throughDay != null,
    }));
  }

  const projected = (payment.allocations ?? []).filter(
    (allocation) => allocation.target === 'expense' && allocation.expenseId,
  );
  if (projected.length === 0) return [blankRow(payment.day)];

  // One row per line, days merged: a span is a detail the owner adds, not one the guess invents.
  const merged = new Map<string, { label: string; amountCents: number; forDay: string }>();
  for (const allocation of payment.allocations ?? []) {
    if (allocation.target !== 'expense' || !allocation.expenseId) continue;
    const found = merged.get(allocation.expenseId);
    if (found) {
      found.amountCents += allocation.amountCents;
      if (allocation.forDay < found.forDay) found.forDay = allocation.forDay;
    } else {
      merged.set(allocation.expenseId, {
        label: allocation.label,
        amountCents: allocation.amountCents,
        forDay: allocation.forDay,
      });
    }
  }

  const totalDisplay = (payment.allocations ?? []).reduce(
    (sum, allocation) => sum + allocation.amountCents,
    0,
  );
  const scale =
    payment.currency === displayCurrency || totalDisplay <= 0 ? 1 : spendableCents / totalDisplay;

  let left = spendableCents;
  return [...merged].map(([expenseId, entry]) => {
    const amountCents = Math.max(0, Math.min(left, Math.round(entry.amountCents * scale)));
    left -= amountCents;
    return {
      key: rowKey(),
      expenseId,
      amountCents,
      forDay: entry.forDay,
      throughDay: '',
      span: false,
    };
  });
}
