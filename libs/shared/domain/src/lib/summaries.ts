import type {
  Cents,
  Currency,
  Id,
  ItemsSummary,
  Loan,
  LoanPayment,
  PersonalPlan,
  PersonalSummary,
  SellableItem,
} from '@life-portal/shared-types';
import { OPEN_ITEM_STATUSES } from '@life-portal/shared-types';
import { diffDays, isAfter, minDay, toDay, yearOf } from './dates';
import { clampPositive, ratio, scaleCents, sumCents } from './money';

/** Total actually repaid on a loan. */
export function paidCents(payments: LoanPayment[]): Cents {
  return sumCents(payments.map((p) => p.amountCents));
}

/** Outstanding balance. Never negative — an overpayment reads as fully repaid. */
export function remainingCents(loan: Loan, payments: LoanPayment[]): Cents {
  return clampPositive(loan.principalCents - paidCents(payments));
}

export function loanProgressRatio(loan: Loan, payments: LoanPayment[]): number {
  return ratio(paidCents(payments), loan.principalCents);
}

export function isOpenItem(item: SellableItem): boolean {
  return OPEN_ITEM_STATUSES.includes(item.status);
}

export function summariseItems(items: SellableItem[], currency: Currency): ItemsSummary {
  const open = items.filter(isOpenItem);
  const sold = items.filter((i) => i.status === 'sold');

  const earmarkedByLoan: Record<Id, Cents> = {};
  for (const item of open) {
    if (!item.allocateToLoanId) continue;
    const share = scaleCents(item.expectedPriceCents, item.allocationRatio ?? 1);
    earmarkedByLoan[item.allocateToLoanId] = (earmarkedByLoan[item.allocateToLoanId] ?? 0) + share;
  }

  return {
    currency,
    openCount: open.length,
    soldCount: sold.length,
    expectedProceedsCents: sumCents(open.map((i) => i.expectedPriceCents)),
    pessimisticProceedsCents: sumCents(open.map((i) => i.minPriceCents ?? i.expectedPriceCents)),
    optimisticProceedsCents: sumCents(open.map((i) => i.askingPriceCents)),
    realisedProceedsCents: sumCents(sold.map((i) => i.soldPriceCents ?? i.expectedPriceCents)),
    earmarkedByLoan,
    nearlySoldCount: open.filter((i) => i.status === 'has_interest' || i.status === 'reserved').length,
  };
}

/** Proceeds from items earmarked for one specific loan, in all three price variants. */
export function itemsProceedsForLoan(
  items: SellableItem[],
  loanId: Id,
): { expectedCents: Cents; pessimisticCents: Cents; optimisticCents: Cents; earliestSaleDate?: string } {
  const relevant = items.filter((i) => isOpenItem(i) && i.allocateToLoanId === loanId);
  const ratioOf = (item: SellableItem) => item.allocationRatio ?? 1;
  return {
    expectedCents: sumCents(relevant.map((i) => scaleCents(i.expectedPriceCents, ratioOf(i)))),
    pessimisticCents: sumCents(
      relevant.map((i) => scaleCents(i.minPriceCents ?? i.expectedPriceCents, ratioOf(i))),
    ),
    optimisticCents: sumCents(relevant.map((i) => scaleCents(i.askingPriceCents, ratioOf(i)))),
    earliestSaleDate: minDay(...relevant.map((i) => i.expectedSaleDate)),
  };
}

/** The date a personal plan happens on: `targetDate`, or a trip's `startDate`. */
export function personalPlanDate(plan: PersonalPlan): string | undefined {
  return plan.targetDate ?? plan.startDate;
}

export function summarisePersonal(
  plans: PersonalPlan[],
  today: string,
  currency: Currency,
): PersonalSummary {
  const active = plans.filter((p) => p.status !== 'cancelled');
  const upcoming = active
    .filter((p) => {
      const date = personalPlanDate(p);
      return date != null && !isAfter(today, toDay(date)) && (p.status === 'planned' || p.status === 'booked');
    })
    .sort((a, b) => {
      const da = personalPlanDate(a) ?? '';
      const db = personalPlanDate(b) ?? '';
      return da < db ? -1 : da > db ? 1 : 0;
    });

  const nextPlan = upcoming[0];
  const nextDate = nextPlan ? personalPlanDate(nextPlan) : undefined;

  const done = active.filter((p) => p.status === 'done');
  const thisYear = yearOf(today);

  return {
    currency,
    ideaCount: active.filter((p) => p.status === 'idea').length,
    plannedCount: active.filter((p) => p.status === 'planned' || p.status === 'booked').length,
    doneCount: done.length,
    next:
      nextPlan && nextDate
        ? {
            id: nextPlan.id,
            title: nextPlan.title,
            date: toDay(nextDate),
            daysUntil: diffDays(today, nextDate),
            company: nextPlan.company,
            estimatedCostCents: nextPlan.estimatedCostCents,
          }
        : undefined,
    upcomingCommittedCents: sumCents(upcoming.map((p) => p.estimatedCostCents)),
    spentThisYearCents: sumCents(
      done
        .filter((p) => {
          const date = personalPlanDate(p);
          return date != null && yearOf(date) === thisYear;
        })
        .map((p) => p.actualCostCents ?? p.estimatedCostCents),
    ),
    countriesVisited: unique(
      active.filter((p) => p.visited || p.status === 'done').map((p) => p.country),
    ),
    countriesWishlist: unique(
      active.filter((p) => !p.visited && p.status !== 'done').map((p) => p.country),
    ),
    tripsPlanned: upcoming.filter((p) => p.type === 'trip').length,
  };
}

function unique(values: (string | undefined)[]): string[] {
  return [...new Set(values.filter((v): v is string => Boolean(v)))].sort();
}
