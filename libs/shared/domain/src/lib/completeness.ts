import type { Cents, CompletenessGap, SpendPayment } from '@life-portal/shared-types';

/**
 * Did we capture every message?
 *
 * One bank (TBC) prints the account balance after every payment, in `reportedBalanceCents`.
 * Chained per card in time order, two consecutive readings must differ by exactly the payments
 * captured between them. When they do not, a message never reached the app — and because the
 * bank did the arithmetic for us, we know the missing amount to the tetri.
 *
 * **This reading is never a balance.** It covers one account of several across two banks, so
 * presenting it as *the* balance would be wrong, and it is never written to `cash_balances`
 * (FR-010b). As one card's own running total it is exact, which is the only thing it is used
 * for. Verified against four consecutive real messages from the owner's phone:
 *
 * ```
 * 1472.30 − 186.48 = 1285.82 ✓   1285.82 −  6.95 = 1278.87 ✓
 * 1278.87 −  14.45 = 1264.42 ✓   1264.42 − 22.19 = 1242.23 ✓
 * ```
 *
 * Derived on every read rather than stored (principle III), so a payment the owner adds by hand
 * later closes its gap automatically without anything being recomputed or migrated.
 *
 * Pure: no clock, no Mongo, no HTTP.
 */

/** The amount a payment moved the account by: out lowers the balance, in raises it. */
function balanceDeltaCents(payment: SpendPayment): Cents {
  // The *full* charge, deliberately. `notReallySpentCents` records that the owner was paid back
  // afterwards, which the ladder cares about and the bank's balance does not — the account still
  // moved by the whole amount on the day, so subtracting a refund here would invent a gap.
  return payment.direction === 'in' ? payment.amountCents : -payment.amountCents;
}

/** Orders by the moment the bank printed. Offsets differ between messages, so compare instants. */
function byInstant(a: SpendPayment, b: SpendPayment): number {
  const left = Date.parse(a.at);
  const right = Date.parse(b.at);
  if (Number.isNaN(left) || Number.isNaN(right)) return a.at < b.at ? -1 : a.at > b.at ? 1 : 0;
  return left - right;
}

/**
 * Every discrepancy between the balances a card reported and the payments captured between them.
 *
 * Each gap is one consecutive pair of balance-carrying payments on one card, with `missingCents`
 * being what the chain cannot account for: positive when money left the account without a message
 * arriving, negative in the rarer case that a payment was recorded twice or overstated.
 *
 * **A card that never reports a balance produces no gaps, and that silence is not evidence of
 * completeness.** Only TBC prints a balance; BOG messages are unverifiable by construction, and
 * an empty result for such a card means "unknowable", not "nothing missing". The UI must not
 * imply otherwise.
 */
export function detectMissedMessages(payments: SpendPayment[]): CompletenessGap[] {
  const byCard = new Map<string, SpendPayment[]>();

  for (const payment of payments) {
    // No card, no chain — a balance cannot be attributed to a stream we cannot identify.
    if (!payment.cardLast4) continue;
    // `unparsed` rows carry no reliable amount, so they can neither anchor the chain nor be
    // deducted from it. One sitting between two readings therefore surfaces as a gap of its own
    // size, which is right: the app genuinely cannot account for that money yet.
    if (payment.status === 'unparsed') continue;

    const group = byCard.get(payment.cardLast4);
    if (group) group.push(payment);
    else byCard.set(payment.cardLast4, [payment]);
  }

  const gaps: CompletenessGap[] = [];

  for (const [cardLast4, group] of byCard) {
    const ordered = [...group].sort(byInstant);

    let anchor: SpendPayment | undefined;
    // What the balance has moved by since `anchor` printed its reading, including the payments
    // in between that carried no reading of their own.
    let movedSinceAnchor = 0;

    for (const payment of ordered) {
      if (payment.reportedBalanceCents == null) {
        // Still spends real money, so it must be counted before the next reading is checked.
        if (anchor) movedSinceAnchor += balanceDeltaCents(payment);
        continue;
      }

      const moved = movedSinceAnchor + balanceDeltaCents(payment);

      if (anchor) {
        const expected = (anchor.reportedBalanceCents as Cents) + moved;
        const missingCents = expected - payment.reportedBalanceCents;
        if (missingCents !== 0) {
          gaps.push({
            cardLast4,
            from: anchor.day,
            to: payment.day,
            missingCents,
          });
        }
      }

      anchor = payment;
      movedSinceAnchor = 0;
    }
  }

  return gaps;
}
