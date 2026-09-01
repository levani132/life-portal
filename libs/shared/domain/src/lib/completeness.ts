import type {
  Cents,
  CompletenessGap,
  Currency,
  FxRate,
  SpendPayment,
} from '@life-portal/shared-types';
import { convertCents } from './money';

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
 * **The chain runs in the account's currency, not each payment's.** A $10 charge on a lari card
 * prints a USD amount over a GEL `Nashti`, and deducting the raw 10.00 from a lari balance
 * invented a permanent ₾17-ish gap per dollar payment. Foreign payments are therefore converted
 * at the rate in force on their own day (`ratesByDay`, from the same archive every other figure
 * uses) — and because the bank converts at *its* rate, not the published one, a segment that
 * needed conversion is checked to within `FX_TOLERANCE` of the amount converted rather than to
 * the tetri. A foreign payment whose day has no rate makes its segment unverifiable, and an
 * unverifiable segment reports nothing: unknowable is not missing.
 *
 * Derived on every read rather than stored (principle III), so a payment the owner adds by hand
 * later closes its gap automatically without anything being recomputed or migrated.
 *
 * Pure: no clock, no Mongo, no HTTP.
 */

/** Per-day `FROM_TO` rate tables (see `rateTable`), keyed by the payment's `day`. */
export type FxRatesByDay = Record<string, Record<string, FxRate>>;

/**
 * How far a converted segment may miss before it counts as a gap, as a fraction of the amount
 * converted. The bank's own card rate sits a percent or two off the published NBG rate this
 * check converts at — never five — so 5% absorbs the spread while a genuinely missing message,
 * which misses by its own whole size, still shows.
 */
const FX_TOLERANCE = 0.05;
/** Rounding a converted delta can be off by a cent even at the bank's exact rate. */
const FX_TOLERANCE_FLOOR: Cents = 2;

/**
 * The amount a payment moved the account by, in the account's own currency: out lowers the
 * balance, in raises it. `null` when the payment is foreign and its day has no rate — the
 * movement is then unknowable, which is different from zero.
 */
function balanceDeltaCents(
  payment: SpendPayment,
  chainCurrency: Currency,
  ratesByDay: FxRatesByDay,
): { cents: Cents; converted: boolean } | null {
  // The *full* charge, deliberately. `notReallySpentCents` records that the owner was paid back
  // afterwards, which the ladder cares about and the bank's balance does not — the account still
  // moved by the whole amount on the day, so subtracting a refund here would invent a gap.
  const signed = payment.direction === 'in' ? payment.amountCents : -payment.amountCents;
  if (payment.currency === chainCurrency) return { cents: signed, converted: false };

  const rates = ratesByDay[payment.day] ?? {};
  const known =
    rates[`${payment.currency}_${chainCurrency}`] != null ||
    rates[`${chainCurrency}_${payment.currency}`] != null;
  // `convertCents` returns the input untouched for an unknown pair — which here is exactly the
  // raw-dollars-off-a-lari-balance bug — so the absence of a rate must be detected, not elided.
  if (!known) return null;

  return {
    cents: convertCents(signed, payment.currency, chainCurrency, rates),
    converted: true,
  };
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
 * arriving, negative in the rarer case that a payment was recorded twice or overstated. It is
 * denominated in the account's currency — GEL unless the readings say otherwise.
 *
 * **A card that never reports a balance produces no gaps, and that silence is not evidence of
 * completeness.** Only TBC prints a balance; BOG messages are unverifiable by construction, and
 * an empty result for such a card means "unknowable", not "nothing missing". The UI must not
 * imply otherwise. The same goes for a segment holding a foreign payment with no rate for its
 * day.
 */
export function detectMissedMessages(
  payments: SpendPayment[],
  ratesByDay: FxRatesByDay = {},
): CompletenessGap[] {
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

    // The currency the card's balance is printed in: from the first reading that names it, GEL
    // otherwise — which covers every row ingested before the parser learned to keep it, all from
    // lari accounts.
    const chainCurrency: Currency =
      ordered.find((p) => p.reportedBalanceCurrency)?.reportedBalanceCurrency ?? 'GEL';

    let anchor: SpendPayment | undefined;
    // What the balance has moved by since `anchor` printed its reading, including the payments
    // in between that carried no reading of their own.
    let movedSinceAnchor = 0;
    // How much of that movement went through a conversion — the base the tolerance scales with.
    let convertedSinceAnchor = 0;
    // A foreign payment with no rate for its day makes the whole segment unknowable.
    let unverifiable = false;

    for (const payment of ordered) {
      const delta = balanceDeltaCents(payment, chainCurrency, ratesByDay);

      if (payment.reportedBalanceCents == null) {
        // Still spends real money, so it must be counted before the next reading is checked.
        if (!anchor) continue;
        if (delta === null) {
          unverifiable = true;
          continue;
        }
        movedSinceAnchor += delta.cents;
        if (delta.converted) convertedSinceAnchor += Math.abs(delta.cents);
        continue;
      }

      if (anchor && delta !== null && !unverifiable) {
        const moved = movedSinceAnchor + delta.cents;
        const convertedVolume =
          convertedSinceAnchor + (delta.converted ? Math.abs(delta.cents) : 0);
        const expected = (anchor.reportedBalanceCents as Cents) + moved;
        const missingCents = expected - payment.reportedBalanceCents;
        // Exact when nothing was converted; within the bank's spread of the converted volume
        // when something was.
        const tolerance =
          convertedVolume > 0
            ? Math.max(Math.round(convertedVolume * FX_TOLERANCE), FX_TOLERANCE_FLOOR)
            : 0;
        if (Math.abs(missingCents) > tolerance) {
          gaps.push({
            cardLast4,
            from: anchor.day,
            to: payment.day,
            missingCents,
          });
        }
      }

      // A reading is a fixed point even when the segment reaching it could not be checked.
      anchor = payment;
      movedSinceAnchor = 0;
      convertedSinceAnchor = 0;
      unverifiable = false;
    }
  }

  return gaps;
}
