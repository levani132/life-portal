/**
 * Budget proposals — what the owner's real spending says an allowance ought to be.
 *
 * A pure function over observed history (principle V): no Mongo, no HTTP, no clock. `today` is
 * always an argument, because "is this period finished?" is the question the whole thing turns
 * on and a hidden clock would make the answer untestable.
 *
 * ## Why the median, never the mean
 *
 * A budget is a routine. The statistic that describes a routine has to survive the days that
 * were not routine: one holiday, one dentist, one broken phone. A mean cannot — a single ₾500
 * evening inside a month of ₾20 days drags the average to ₾37 and the app would confidently
 * propose nearly doubling the food allowance on the strength of one dinner. The median simply
 * does not move: it reports the middle day, and the middle day is what an allowance funds.
 * That is the same reasoning the cash-flow trailing statistic uses (research §10), and there
 * is a test here asserting the mean would have proposed differently.
 *
 * ## Why a minimum history exists
 *
 * FR-037. A proposal is a claim about a habit, and three days of data is not evidence of a
 * habit — it is evidence of three days. Worse, the app's own capture is incomplete at the
 * start: messages only arrive once the automation is running, so early periods read as
 * under-spent for a reason that has nothing to do with the owner's behaviour. Proposing from
 * that would teach the owner that the proposals are wrong, which costs more than the silence.
 * 28 complete days / 8 complete weeks / 4 complete months (research §10).
 *
 * ## Why a deviation threshold exists
 *
 * Real spending is never exactly the budget. Without a floor, every line would carry a
 * permanent ±3% proposal, and a notification that is always present is a notification that is
 * never read. Both tests must pass — a proportional one (15%) and an absolute one (~₾5) —
 * because 15% of a ₾10 daily line is ₾1.50, which is not worth anyone's attention, and ₾5 of
 * a ₾900 rent line is noise.
 *
 * Nothing here changes a budget (FR-036). It proposes; the owner accepts.
 *
 * See `specs/002-spending-waterfall/contracts/domain.md` and research §10.
 */
import type {
  BudgetProposal,
  Cadence,
  Cents,
  Currency,
  Id,
  IsoDate,
} from '@life-portal/shared-types';
import { diffDays, toDay } from './dates';
import { formatCents } from './money';
import type { LadderTierBudget } from './spend-waterfall';

/**
 * Complete periods needed before a cadence may be proposed on at all (FR-037, research §10).
 *
 * `yearly` is included for completeness of the map rather than because it will ever be met:
 * three complete years of capture is longer than the app has existed, so a yearly line is in
 * practice never proposed on — which is the right answer, not an oversight.
 */
export const MINIMUM_COMPLETE_PERIODS: Record<Cadence, number> = {
  daily: 28,
  weekly: 8,
  monthly: 4,
  yearly: 3,
};

/** Proportional threshold. Both this **and** the absolute one must be crossed. */
export const MIN_DEVIATION_RATIO = 0.15;

/** Absolute threshold, in the display currency's minor units — about ₾5. */
export const MIN_DEVIATION_CENTS = 500;

/** How many times a custom purpose must recur before it looks like a habit (FR-049). */
export const MIN_PURPOSE_OCCURRENCES = 4;

/** …and over how long, so four buys in one week are not read as a monthly line. */
export const MIN_PURPOSE_SPAN_DAYS = 28;

/** …and across how many finished months, so the median of the monthly totals means something. */
export const MIN_PURPOSE_MONTHS = 2;

/**
 * Marks a proposal for a line that does not exist yet.
 *
 * A `BudgetProposal` is keyed by `expenseId`, and a purpose the owner has been paying for
 * without ever budgeting it has no expense to key on. Rather than a second result type the UI
 * would have to special-case everywhere, a new-line proposal carries a synthetic id under this
 * prefix — `isNewLineProposal` is the one place that knowledge lives.
 */
export const NEW_LINE_PREFIX = 'purpose:';

/** The synthetic id for a purpose that has no budget line yet. */
export function newLineProposalId(purpose: string): Id {
  return `${NEW_LINE_PREFIX}${normalisePurpose(purpose)}`;
}

/** Whether a proposal is asking to create a line rather than to revise one. */
export function isNewLineProposal(proposal: Pick<BudgetProposal, 'expenseId'>): boolean {
  return proposal.expenseId.startsWith(NEW_LINE_PREFIX);
}

/** What one budgeted line really consumed in one period of its cadence. */
export interface LinePeriodSpend {
  expenseId: Id;
  /** First day of the period. */
  from: IsoDate;
  /** Last day of the period. The period counts as complete only once `to < today`. */
  to: IsoDate;
  /** Consumed in that period, in the display currency. */
  spentCents: Cents;
}

/** One payment recorded against a custom purpose, already converted to the display currency. */
export interface PurposeOccurrence {
  day: IsoDate;
  amountCents: Cents;
}

/** A custom purpose the owner has been paying for outside every budgeted line (FR-049). */
export interface CustomPurposeHistory {
  /** As the owner typed it. Shown back to them verbatim. */
  purpose: string;
  occurrences: PurposeOccurrence[];
  /** Set once this purpose has become a budget line. Never proposed again. */
  promotedToExpenseId?: Id;
}

/** A proposal the owner said no to, as stored on the expense row (research §10). */
export interface BudgetDismissal {
  at: IsoDate;
  cents: Cents;
}

export interface SuggestBudgetsInput {
  /** Reference day. Decides which periods are finished. Explicit, always (principle V). */
  today: IsoDate;
  /** The ladder as it stands, for labels, cadences and the budgets being compared against. */
  tiers: LadderTierBudget[];
  /** Per line, per period, what was really consumed. Incomplete periods may be included. */
  history: LinePeriodSpend[];
  /**
   * The first day the app has any capture for. Periods starting before it are dropped: they
   * read as under-spent because nothing was recorded yet, not because nothing was spent.
   */
  observedFrom?: IsoDate;
  /** Keyed by `expenseId` (or by a new-line proposal id). */
  dismissals?: Record<Id, BudgetDismissal>;
  /** Custom purposes that consumed no allowance, for new-line proposals (FR-049). */
  purposes?: CustomPurposeHistory[];
  /** The currency every figure here is already in. Used only to write the basis sentence. */
  currency?: Currency;
  /** Override for `MIN_DEVIATION_CENTS`, for a display currency where ₾5 is the wrong floor. */
  minDeviationCents?: Cents;
}

/* ---------------------------------------------------------------------------- statistics -- */

/**
 * The middle value, in whole minor units.
 *
 * An even count averages the two middle values and rounds, so the result stays an integer
 * number of cents (principle II) rather than acquiring a half-tetri no account can hold.
 */
export function median(values: Cents[]): Cents {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

/** Whether two figures differ by enough to be worth saying out loud. Both tests must pass. */
function deviatesMaterially(observed: Cents, against: Cents, minCents: Cents): boolean {
  const gap = Math.abs(observed - against);
  if (gap < minCents) return false;
  // A zero reference has no proportion to exceed; without this guard it would divide by zero
  // and every unbudgeted line would propose itself. A line budgeted at nothing is not a
  // budget, so there is nothing to revise.
  if (against === 0) return false;
  return gap / against >= MIN_DEVIATION_RATIO;
}

/**
 * Whether the evidence has moved far enough from a refused figure to be worth asking again.
 *
 * Not quite the same test as `deviatesMaterially`, and the difference matters: a dismissed
 * figure may legitimately be **zero** — a line the owner never actually spends on will be
 * proposed at ₾0 — and there is no proportion to take against zero. Reusing the budget test
 * here would silence that line for ever, whatever it went on to cost. Against a zero
 * refusal the absolute floor is the whole test.
 */
function movedMateriallyFrom(observed: Cents, dismissed: Cents, minCents: Cents): boolean {
  const gap = Math.abs(observed - dismissed);
  if (gap < minCents) return false;
  if (dismissed === 0) return true;
  return gap / Math.abs(dismissed) >= MIN_DEVIATION_RATIO;
}

const PERIOD_NOUN: Record<Cadence, string> = {
  daily: 'days',
  weekly: 'weeks',
  monthly: 'months',
  yearly: 'years',
};

const PERIOD_ADVERB: Record<Cadence, string> = {
  daily: 'a day',
  weekly: 'a week',
  monthly: 'a month',
  yearly: 'a year',
};

/**
 * How much to trust a proposal, from how much history stands behind it.
 *
 * Deliberately coarse. The honest signal is "barely enough" versus "plenty", and a finer
 * gradation would imply a precision the underlying capture does not have.
 */
function confidenceFor(periods: number, minimum: number): 'low' | 'medium' | 'high' {
  if (periods >= minimum * 2) return 'high';
  if (periods >= minimum * 1.5) return 'medium';
  return 'low';
}

function normalisePurpose(purpose: string): string {
  return purpose.trim().toLowerCase();
}

/* ------------------------------------------------------------------------------- the thing -- */

/**
 * Proposes revised budgets for lines whose real spending has consistently differed from them,
 * plus new lines for custom purposes that have become habits.
 *
 * Returns `Estimate<Cents>` values (principle VI): every proposal carries the median it was
 * drawn from, the window it covers and a sentence saying so, because a number that asks the
 * owner to change a budget has to show its working.
 */
export function suggestBudgets(input: SuggestBudgetsInput): BudgetProposal[] {
  const today = toDay(input.today);
  const currency = input.currency ?? 'GEL';
  const minDeviationCents = input.minDeviationCents ?? MIN_DEVIATION_CENTS;
  const dismissals = input.dismissals ?? {};
  const observedFrom = input.observedFrom ? toDay(input.observedFrom) : undefined;

  const money = (cents: Cents) => formatCents(cents, currency, { forceDecimals: true });

  /**
   * A period counts only once it is over and only if capture covered it.
   *
   * Half a month is not a month: including the current period would compare a partial total
   * against a whole allowance and propose a cut every time the app was opened mid-month.
   */
  const complete = input.history.filter((period) => {
    if (toDay(period.to) >= today) return false;
    if (observedFrom && toDay(period.from) < observedFrom) return false;
    return true;
  });

  const byExpense = new Map<Id, LinePeriodSpend[]>();
  for (const period of complete) {
    const existing = byExpense.get(period.expenseId);
    if (existing) existing.push(period);
    else byExpense.set(period.expenseId, [period]);
  }

  const proposals: BudgetProposal[] = [];

  for (const tier of input.tiers) {
    const minimum = MINIMUM_COMPLETE_PERIODS[tier.cadence];
    for (const rung of tier.rungs) {
      // Three reasons a line can never be proposed on, each a different one:
      //   - `manual` is settled by hand, so the cascade never observed it and its consumption
      //     reads as zero. Proposing from that would suggest cutting the loan repayment to nil.
      //   - a one-off is a specific intention, not a habit, and has no repeat to take a median of.
      //   - a line in another currency would have its display-currency median written straight
      //     into a field denominated in its own, turning a $40 allowance into ₾40.
      if ((rung.settlement ?? 'auto') === 'manual') continue;
      if ((rung.kind ?? 'recurring') === 'one_off') continue;
      if (rung.currency !== currency) continue;

      const periods = (byExpense.get(rung.expenseId) ?? []).sort((a, b) =>
        a.from.localeCompare(b.from),
      );
      // FR-037. Below the minimum the honest answer is nothing at all.
      if (periods.length < minimum) continue;

      const medianCents = median(periods.map((p) => p.spentCents));
      if (!deviatesMaterially(medianCents, rung.budgetCents, minDeviationCents)) continue;

      // A dismissal is about a *figure*, not about the line: the owner said "not that number".
      // It lapses as soon as the evidence has moved somewhere materially else, so a habit that
      // really is changing is proposed again rather than silenced for ever.
      const dismissed = dismissals[rung.expenseId];
      if (dismissed && !movedMateriallyFrom(medianCents, dismissed.cents, minDeviationCents)) {
        continue;
      }

      const from = periods[0].from;
      const to = periods[periods.length - 1].to;
      proposals.push({
        value: medianCents,
        suggestedCents: medianCents,
        currentCents: rung.budgetCents,
        expenseId: rung.expenseId,
        label: rung.label,
        cadence: tier.cadence,
        basis:
          `Median of ${periods.length} complete ${PERIOD_NOUN[tier.cadence]} was ` +
          `${money(medianCents)} against a ${money(rung.budgetCents)} allowance`,
        assumptions: {
          periods: periods.length,
          cadence: tier.cadence,
          medianCents,
          currentCents: rung.budgetCents,
          deviationCents: medianCents - rung.budgetCents,
          from,
          to,
          currency,
          statistic: 'median',
        },
        confidence: confidenceFor(periods.length, minimum),
      });
    }
  }

  proposals.push(
    ...suggestNewLines({ today, currency, minDeviationCents, dismissals, money }, input.purposes),
  );

  // Largest change first, so the proposal worth reading is the one at the top. The id tiebreak
  // keeps the order independent of the order the caller happened to assemble the tiers in.
  return proposals.sort((a, b) => {
    const gap =
      Math.abs(b.suggestedCents - b.currentCents) - Math.abs(a.suggestedCents - a.currentCents);
    return gap !== 0 ? gap : a.expenseId.localeCompare(b.expenseId);
  });
}

interface NewLineContext {
  today: IsoDate;
  currency: Currency;
  minDeviationCents: Cents;
  dismissals: Record<Id, BudgetDismissal>;
  money: (cents: Cents) => string;
}

/**
 * Proposes a *new* monthly line for a custom purpose that has recurred like a habit (FR-049).
 *
 * The shape of the evidence is different from a revision — there is no budget to deviate from —
 * so the guards are different too: enough separate payments, spread over long enough that four
 * buys in one week cannot masquerade as a standing cost, and enough finished months for a
 * median of the monthly totals to describe anything.
 *
 * Months inside the observed span with no payments count as zero rather than being skipped.
 * Dropping them would take the median of only the months the owner spent, which is how a
 * twice-a-year purchase gets proposed as a monthly line.
 */
function suggestNewLines(
  context: NewLineContext,
  purposes: CustomPurposeHistory[] | undefined,
): BudgetProposal[] {
  if (!purposes?.length) return [];
  const currentMonth = context.today.slice(0, 7);
  const proposals: BudgetProposal[] = [];

  for (const entry of purposes) {
    // Already a budget line. It is revised by the branch above, not proposed again.
    if (entry.promotedToExpenseId) continue;

    const occurrences = entry.occurrences
      .filter((o) => toDay(o.day) < context.today)
      .sort((a, b) => a.day.localeCompare(b.day));
    if (occurrences.length < MIN_PURPOSE_OCCURRENCES) continue;

    const first = occurrences[0].day;
    const last = occurrences[occurrences.length - 1].day;
    if (diffDays(first, last) < MIN_PURPOSE_SPAN_DAYS) continue;

    // Calendar months, deliberately: a custom purpose consumes no allowance, so it belongs to
    // no financial month and there is no `monthStartsOn` to honour here.
    const totals = new Map<string, Cents>();
    for (const month of monthsBetween(first, last)) {
      if (month >= currentMonth) continue;
      totals.set(month, 0);
    }
    for (const occurrence of occurrences) {
      const month = toDay(occurrence.day).slice(0, 7);
      if (month >= currentMonth) continue;
      totals.set(month, (totals.get(month) ?? 0) + occurrence.amountCents);
    }
    if (totals.size < MIN_PURPOSE_MONTHS) continue;

    const medianCents = median([...totals.values()]);
    if (medianCents < context.minDeviationCents) continue;

    const id = newLineProposalId(entry.purpose);
    const dismissed = context.dismissals[id];
    if (
      dismissed &&
      !movedMateriallyFrom(medianCents, dismissed.cents, context.minDeviationCents)
    ) {
      continue;
    }

    const label = entry.purpose.trim();
    proposals.push({
      value: medianCents,
      suggestedCents: medianCents,
      // Nothing is budgeted for it today — that is the entire point of the proposal.
      currentCents: 0,
      expenseId: id,
      label,
      cadence: 'monthly',
      basis:
        `Paid ${occurrences.length} times as "${label}" with no budget line; the median of ` +
        `${totals.size} complete months is ${context.money(medianCents)} ` +
        `${PERIOD_ADVERB['monthly']}`,
      assumptions: {
        periods: totals.size,
        cadence: 'monthly',
        medianCents,
        occurrences: occurrences.length,
        from: first,
        to: last,
        purpose: label,
        currency: context.currency,
        statistic: 'median',
      },
      confidence: confidenceFor(totals.size, MIN_PURPOSE_MONTHS),
    });
  }

  return proposals;
}

/** Every `YYYY-MM` from the month of `from` to the month of `to`, inclusive. */
function monthsBetween(from: IsoDate, to: IsoDate): string[] {
  const months: string[] = [];
  let year = Number(from.slice(0, 4));
  let month = Number(from.slice(5, 7));
  const end = toDay(to).slice(0, 7);
  for (;;) {
    const key = `${year}-${String(month).padStart(2, '0')}`;
    months.push(key);
    if (key >= end) return months;
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
}
