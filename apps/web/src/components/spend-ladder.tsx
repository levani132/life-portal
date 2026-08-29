'use client';

import clsx from 'clsx';
import type { Cadence, LadderRung, LadderTier, SpendLadder } from '@life-portal/shared-types';
import { formatCents } from '@life-portal/shared-domain';
import { Chip, EmptyState, EstimateMark, Panel, ProgressBar } from './ui';

/**
 * The ladder, drawn as filling bars.
 *
 * Deliberately **not** a checklist. For an unconfirmed rung the name records *which allowance was
 * consumed*, not what was bought — the same supermarket sells dinner one visit and a vase the
 * next, and the waterfall re-proposes every attribution on every read (principle III). A tick-box
 * would claim knowledge the app does not have.
 *
 * A rung the owner has confirmed is the one exception: they stated the truth about it, so it may
 * read as settled, and whatever it did not use is a *saving* rather than money still available.
 */

const TIER_LABEL: Record<Cadence, string> = {
  daily: 'Today',
  weekly: 'This week',
  monthly: 'This month',
  yearly: 'This year',
};

const TIER_HINT: Record<Cadence, string> = {
  daily: 'Allowances that reset every day.',
  weekly: 'Filled once the day is used up.',
  monthly: 'Filled once the week is used up.',
  yearly: 'The last thing anything falls into.',
};

export function SpendLadderView({
  ladder,
  currency,
  className,
}: {
  ladder: SpendLadder;
  currency: string;
  className?: string;
}) {
  const approximate = ladder.unconvertedCurrencies ?? [];

  return (
    <Panel
      title="Where the money is landing"
      description="Each allowance is a bar that fills as it is used. The names are markers along it — they say which allowance a payment consumed, not what you bought."
      className={className}
    >
      {ladder.tiers.length === 0 ? (
        <EmptyState message="No budget lines yet, so there is nothing for spending to land on. Add a few in cash flow and every payment starts finding its place." />
      ) : (
        <div className="space-y-6">
          {ladder.tiers.map((tier) => (
            <Tier key={tier.cadence} tier={tier} currency={currency} />
          ))}
        </div>
      )}

      <ExtraBar cents={ladder.extraCents} currency={currency} />

      {approximate.length > 0 && (
        <p className="mt-3 text-xs text-amber-300">
          No rate was available for {approximate.join(', ')}, so every figure above is approximate
          <EstimateMark basis="Some payments could not be converted to your display currency." />
        </p>
      )}

      <p className="mt-3 text-xs text-ink-faint">
        Nothing here is a record of what you bought. Open a payment to say what it really was —
        until you do, these names are only the app&rsquo;s reading of which allowance it used.
      </p>
    </Panel>
  );
}

function Tier({ tier, currency }: { tier: LadderTier; currency: string }) {
  const overspent = tier.savingCents < 0;
  const ratio = tier.budgetCents > 0 ? tier.consumedCents / tier.budgetCents : 0;

  return (
    <section>
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-ink">{TIER_LABEL[tier.cadence]}</h3>
          <p className="text-[11px] text-ink-faint">{TIER_HINT[tier.cadence]}</p>
        </div>
        <p className="tabular shrink-0 text-xs text-ink-muted">
          {formatCents(tier.consumedCents, currency)} of {formatCents(tier.budgetCents, currency)}
        </p>
      </header>

      <div className="mt-2">
        <ProgressBar ratio={ratio} tone={barTone(ratio)} />
      </div>

      {/* Signed on purpose: a negative saving is an overspend, and saying "0 saved" would hide it. */}
      <p
        className={clsx(
          'tabular mt-1 text-[11px]',
          overspent ? 'text-rose-400' : 'text-emerald-400',
        )}
      >
        {overspent
          ? `${formatCents(Math.abs(tier.savingCents), currency)} over budget`
          : `${formatCents(tier.savingCents, currency)} saved so far`}
      </p>

      {tier.rungs.length === 0 ? (
        <p className="mt-2 text-xs text-ink-faint">Nothing budgeted at this cadence.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {tier.rungs.map((rung) => (
            <li key={rung.expenseId}>
              <Rung rung={rung} currency={currency} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Rung({ rung, currency }: { rung: LadderRung; currency: string }) {
  const manual = rung.settlement === 'manual';
  const ratio = rung.budgetCents > 0 ? rung.consumedCents / rung.budgetCents : 0;
  const pastBudget = Math.max(0, rung.consumedCents - rung.budgetCents);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="truncate text-sm text-ink">{rung.label}</span>
          {rung.confirmed && <Chip tone="good">settled</Chip>}
          {manual && <Chip>paid by hand</Chip>}
        </div>
        <span className="tabular shrink-0 text-xs text-ink-faint">
          {formatCents(rung.consumedCents, currency)} of {formatCents(rung.budgetCents, currency)}
        </span>
      </div>

      <div className="mt-1.5">
        <ProgressBar
          ratio={ratio}
          tone={manual ? 'neutral' : rung.confirmed ? 'good' : barTone(ratio)}
        />
      </div>

      <p className="mt-1 text-[11px] text-ink-faint">{rungNote(rung, currency, pastBudget)}</p>
    </div>
  );
}

/**
 * The one line under a rung's bar, which is where the difference between a guess and a fact
 * actually shows up.
 */
function rungNote(rung: LadderRung, currency: string, pastBudget: number): string {
  if (rung.settlement === 'manual') {
    return 'Settled by hand. It counts towards the budget above but is never charged automatically, so a big evening can never be booked against it.';
  }
  if (rung.confirmed) {
    return rung.remainingCents > 0
      ? `${formatCents(rung.remainingCents, currency)} saved — you said what this allowance went on, so nothing else may be guessed into it.`
      : 'Used up, and you said so yourself.';
  }
  if (pastBudget > 0) {
    return `${formatCents(pastBudget, currency)} past its budget. The overflow went on to the next bar.`;
  }
  return rung.remainingCents > 0
    ? `${formatCents(rung.remainingCents, currency)} of this allowance still unused.`
    : 'Nothing left here. Anything more falls to the next bar down.';
}

/** Spending that ran past every tier, plus every custom purpose. It belongs to no budget line. */
function ExtraBar({ cents, currency }: { cents: number; currency: string }) {
  return (
    <div className="mt-5 rounded-lg border border-border bg-surface px-3 py-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <p className="text-sm font-medium text-ink">Unplanned this month</p>
        <p
          className={clsx(
            'tabular shrink-0 text-sm font-medium',
            cents > 0 ? 'text-amber-400' : 'text-ink-faint',
          )}
        >
          {formatCents(cents, currency)}
        </p>
      </div>
      <p className="mt-0.5 text-[11px] text-ink-faint">
        Spending that exhausted every allowance, plus anything you gave its own purpose. It sits
        outside the budget entirely rather than being squeezed into a line that was already full.
      </p>
    </div>
  );
}

function barTone(ratio: number): 'good' | 'warn' | 'bad' {
  if (ratio > 1) return 'bad';
  if (ratio > 0.8) return 'warn';
  return 'good';
}
