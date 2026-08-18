import type { Id, Loan, LoanPayment, RepaymentPlan } from '@life-portal/shared-types';
import { clampPositive, sumCents } from './money';
import { toDay, type DayString } from './dates';
import { occurrencesBetween } from './recurrence';
import { resolvePlanAmountCents } from './loan-scenarios';
import { paidCents, remainingCents } from './summaries';

/**
 * What is owed, and what *would* be owed if the repayment plan has been kept to.
 *
 * `remainingCents` counts recorded payments only — a plan is an intention, and treating one as
 * history would understate a real debt. But a scheduled repayment that has already fallen due
 * and is not recorded is worth flagging: the cash-flow projection has already spent that money
 * (the linked expense goes out every month), so leaving the debt untouched makes the two widgets
 * disagree about the same dollar. `expectedRemainingCents` is that reconciliation, labelled as
 * the estimate it is.
 */
export interface LoanBalance {
  paidCents: number;
  /** `principal − recorded payments`, clamped at zero. The authoritative figure. */
  remainingCents: number;
  /** Scheduled repayments already due that no recorded payment accounts for. */
  unrecordedScheduledCents: number;
  unrecordedCount: number;
  /** The earliest scheduled date left unaccounted for. */
  unrecordedFromDate?: string;
  /** `remaining − unrecordedScheduled`: the balance if every scheduled payment went out. */
  expectedRemainingCents: number;
}

/** One dated instalment a plan says should have gone out. */
interface DueInstalment {
  date: DayString;
  amountCents: number;
}

/**
 * Instalments a plan says have already fallen due, oldest first.
 *
 * Only *guaranteed*, enabled plans with a real schedule count. Item and share sales are
 * possibilities, not commitments, so they never appear here.
 */
function instalmentsDue(
  plan: RepaymentPlan,
  linkedExpenseAmounts: Record<Id, number>,
  today: DayString,
): DueInstalment[] {
  if (!plan.enabled || !plan.guaranteed) return [];
  const amountCents = resolvePlanAmountCents(plan, linkedExpenseAmounts);
  if (amountCents <= 0) return [];

  if (plan.kind === 'one_off') {
    if (!plan.date) return [];
    const date = toDay(plan.date);
    return date <= today ? [{ date, amountCents }] : [];
  }

  if (plan.kind !== 'recurring' || !plan.startDate) return [];
  const end = plan.endDate ? (toDay(plan.endDate) < today ? toDay(plan.endDate) : today) : today;
  return occurrencesBetween(
    {
      cadence: plan.cadence ?? 'monthly',
      interval: 1,
      dayOfMonth: plan.dayOfMonth,
      startDate: plan.startDate,
      endDate: plan.endDate,
    },
    plan.startDate,
    end,
  ).map((date) => ({ date, amountCents }));
}

export function loanBalance(
  loan: Loan,
  payments: LoanPayment[],
  plans: RepaymentPlan[],
  linkedExpenseAmounts: Record<Id, number>,
  today: string,
): LoanBalance {
  const asOf = toDay(today);
  const paid = paidCents(payments);
  const remaining = remainingCents(loan, payments);

  const due = plans
    .flatMap((plan) => instalmentsDue(plan, linkedExpenseAmounts, asOf))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  // Payments recorded from the first scheduled date onward are what those instalments could
  // have been. Anything paid before the schedule began (an opening-balance adjustment, say)
  // is already in `remaining` and must not be spent twice.
  const scheduleStart = due[0]?.date;
  let credit = scheduleStart
    ? sumCents(
        payments.filter((payment) => toDay(payment.date) >= scheduleStart).map((p) => p.amountCents),
      )
    : 0;

  let unrecordedCents = 0;
  let unrecordedCount = 0;
  let unrecordedFromDate: string | undefined;
  for (const instalment of due) {
    if (credit >= instalment.amountCents) {
      credit -= instalment.amountCents;
      continue;
    }
    const shortfall = instalment.amountCents - credit;
    credit = 0;
    unrecordedCents += shortfall;
    unrecordedCount += 1;
    unrecordedFromDate ??= instalment.date;
  }

  // Never claim more has been repaid than is owed.
  const unrecordedScheduledCents = Math.min(unrecordedCents, remaining);

  return {
    paidCents: paid,
    remainingCents: remaining,
    unrecordedScheduledCents,
    unrecordedCount,
    unrecordedFromDate,
    expectedRemainingCents: clampPositive(remaining - unrecordedScheduledCents),
  };
}
