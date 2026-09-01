import type { SpendPayment } from '@life-portal/shared-types';
import { detectMissedMessages } from './completeness';
import { rateTable } from './fx';

/** Everything a `SpendPayment` needs that this check never looks at. */
function payment(overrides: Partial<SpendPayment> & Pick<SpendPayment, 'id'>): SpendPayment {
  return {
    userId: 'u1',
    amountCents: 0,
    currency: 'GEL',
    at: '2026-08-18T09:00:00+04:00',
    day: '2026-08-18',
    direction: 'out',
    source: 'sms',
    bank: 'tbc',
    status: 'recorded',
    createdAt: '2026-08-18',
    updatedAt: '2026-08-18',
    ...overrides,
  };
}

/**
 * The owner's real messages, four consecutive TBC notifications from one card. Each one's own
 * amount comes off the previous reading to give its own:
 *
 * 1472.30 − 186.48 = 1285.82 · − 6.95 = 1278.87 · − 14.45 = 1264.42 · − 22.19 = 1242.23
 */
const verifiedChain: SpendPayment[] = [
  payment({
    id: 'p1',
    cardLast4: '4419',
    amountCents: 18_648,
    at: '2026-08-18T10:12:00+04:00',
    day: '2026-08-18',
    reportedBalanceCents: 128_582,
  }),
  payment({
    id: 'p2',
    cardLast4: '4419',
    amountCents: 695,
    at: '2026-08-18T13:40:00+04:00',
    day: '2026-08-18',
    reportedBalanceCents: 127_887,
  }),
  payment({
    id: 'p3',
    cardLast4: '4419',
    amountCents: 1_445,
    at: '2026-08-19T09:05:00+04:00',
    day: '2026-08-19',
    reportedBalanceCents: 126_442,
  }),
  payment({
    id: 'p4',
    cardLast4: '4419',
    amountCents: 2_219,
    at: '2026-08-19T19:30:00+04:00',
    day: '2026-08-19',
    reportedBalanceCents: 124_223,
  }),
];

describe('detectMissedMessages', () => {
  it('reports nothing for the owner’s verified four-message chain', () => {
    expect(detectMissedMessages(verifiedChain)).toEqual([]);
  });

  it('is not fooled by the order the messages arrive in', () => {
    const shuffled = [verifiedChain[2], verifiedChain[0], verifiedChain[3], verifiedChain[1]];
    expect(detectMissedMessages(shuffled)).toEqual([]);
  });

  it('names the exact amount of a message that never arrived', () => {
    // Withhold the 14.45 notification: the balances either side no longer meet.
    const withheld = verifiedChain.filter((p) => p.id !== 'p3');

    expect(detectMissedMessages(withheld)).toEqual([
      {
        cardLast4: '4419',
        from: '2026-08-18',
        to: '2026-08-19',
        missingCents: 1_445,
      },
    ]);
  });

  it('counts a captured payment that carried no balance of its own', () => {
    // The 14.45 arrived, but as a message without a `Nashti` line. The chain must still close.
    const noBalance = verifiedChain.map((p) =>
      p.id === 'p3' ? { ...p, reportedBalanceCents: undefined } : p,
    );

    expect(detectMissedMessages(noBalance)).toEqual([]);
  });

  it('raises the balance for money coming in', () => {
    const withRefund: SpendPayment[] = [
      verifiedChain[0],
      payment({
        id: 'in1',
        cardLast4: '4419',
        amountCents: 5_000,
        direction: 'in',
        at: '2026-08-18T11:00:00+04:00',
        day: '2026-08-18',
        reportedBalanceCents: 133_582,
      }),
      // 1335.82 − 6.95 = 1328.87.
      { ...verifiedChain[1], reportedBalanceCents: 132_887 },
    ];

    expect(detectMissedMessages(withRefund)).toEqual([]);
  });

  it('deducts the full charge even when part of it was paid back', () => {
    // The bank's balance moved by the whole 186.48; being reimbursed later is the ladder's
    // business, not the account's.
    const reimbursed = verifiedChain.map((p) =>
      p.id === 'p1' ? { ...p, notReallySpentCents: 10_000 } : p,
    );

    expect(detectMissedMessages(reimbursed)).toEqual([]);
  });

  it('ignores unparsed rows, whose amount is not to be trusted', () => {
    const withUnparsed: SpendPayment[] = [
      verifiedChain[0],
      payment({
        id: 'junk',
        cardLast4: '4419',
        // Garbage left by a message the parser refused: deducting it would invent a gap.
        amountCents: 99_999,
        at: '2026-08-18T12:00:00+04:00',
        day: '2026-08-18',
        status: 'unparsed',
        raw: 'a message no parser recognised',
      }),
      verifiedChain[1],
    ];

    expect(detectMissedMessages(withUnparsed)).toEqual([]);
  });

  it('chains two cards independently even when their messages interleave', () => {
    const otherCard: SpendPayment[] = [
      payment({
        id: 'q1',
        cardLast4: '8802',
        amountCents: 1_000,
        at: '2026-08-18T10:30:00+04:00',
        day: '2026-08-18',
        reportedBalanceCents: 50_000,
      }),
      payment({
        id: 'q2',
        cardLast4: '8802',
        amountCents: 2_500,
        at: '2026-08-18T14:00:00+04:00',
        day: '2026-08-18',
        // 500.00 − 25.00 = 475.00, but 460.00 was reported: 15.00 went missing on this card only.
        reportedBalanceCents: 46_000,
      }),
    ];

    const interleaved = [
      verifiedChain[0],
      otherCard[0],
      verifiedChain[1],
      otherCard[1],
      verifiedChain[2],
      verifiedChain[3],
    ];

    expect(detectMissedMessages(interleaved)).toEqual([
      {
        cardLast4: '8802',
        from: '2026-08-18',
        to: '2026-08-18',
        missingCents: 1_500,
      },
    ]);
  });

  it('finds no gap in a single payment, however it is chained', () => {
    expect(detectMissedMessages([verifiedChain[0]])).toEqual([]);
    expect(detectMissedMessages([])).toEqual([]);
  });

  it('produces no gaps for a card that never reports a balance', () => {
    // BOG prints no balance. Silence here means "unknowable", never "nothing missing" — the
    // absence of a gap on such a card is not evidence of completeness.
    const bog = verifiedChain.map((p) => ({
      ...p,
      bank: 'bog' as const,
      cardLast4: '7710',
      reportedBalanceCents: undefined,
    }));

    expect(detectMissedMessages(bog)).toEqual([]);
  });

  it('ignores payments with no card, which cannot belong to any chain', () => {
    const cardless = payment({
      id: 'cash',
      amountCents: 4_000,
      at: '2026-08-18T11:30:00+04:00',
      day: '2026-08-18',
      source: 'manual',
    });

    expect(detectMissedMessages([...verifiedChain, cardless])).toEqual([]);
  });

  it('reports a negative amount when a payment was counted twice', () => {
    const doubled = [...verifiedChain, { ...verifiedChain[1], id: 'p2-dup' }];

    // The duplicate is deducted a second time, so the chain expects less than the bank reported.
    expect(detectMissedMessages(doubled)).toEqual([
      {
        cardLast4: '4419',
        from: '2026-08-18',
        to: '2026-08-18',
        missingCents: -695,
      },
    ]);
  });
});

describe('detectMissedMessages across currencies', () => {
  // 2.70 lari to the dollar, expanded to the flat FROM_TO table the check reads — the same
  // shape `rateTable` hands every other conversion in the app.
  const rates = rateTable('GEL', { USD: 2.7 });
  const ratesByDay = { '2026-08-18': rates, '2026-08-19': rates };

  const anchor = payment({
    id: 'fx0',
    cardLast4: '4419',
    amountCents: 18_648,
    at: '2026-08-18T10:12:00+04:00',
    reportedBalanceCents: 128_582,
    reportedBalanceCurrency: 'GEL',
  });

  /** A $10 charge on the lari card, as TBC prints it: USD amount, GEL `Nashti`. */
  function dollarPayment(overrides: Partial<SpendPayment>): SpendPayment {
    return payment({
      id: 'fx-usd',
      cardLast4: '4419',
      amountCents: 1_000,
      currency: 'USD',
      at: '2026-08-18T12:00:00+04:00',
      reportedBalanceCurrency: 'GEL',
      ...overrides,
    });
  }

  it('values a dollar payment at its own day’s rate, never at face value', () => {
    // The bank moved the account by ₾27.00, not by "10.00": 1285.82 − 27.00 = 1258.82.
    const chain = [anchor, dollarPayment({ reportedBalanceCents: 125_882 })];

    expect(detectMissedMessages(chain, ratesByDay)).toEqual([]);
  });

  it('converts a dollar payment that carried no reading of its own', () => {
    // The $10 sits between two GEL readings: 1285.82 − 27.00 − 6.95 = 1251.87.
    const chain = [
      anchor,
      dollarPayment({ reportedBalanceCents: undefined }),
      payment({
        id: 'fx1',
        cardLast4: '4419',
        amountCents: 695,
        at: '2026-08-18T13:40:00+04:00',
        reportedBalanceCents: 125_187,
        reportedBalanceCurrency: 'GEL',
      }),
    ];

    expect(detectMissedMessages(chain, ratesByDay)).toEqual([]);
  });

  it('absorbs the bank converting at its own rate rather than the published one', () => {
    // The card charged ₾27.50 (a 2.75 rate) while NBG published 2.70 — fifty tetri of spread,
    // not a missing message: 1285.82 − 27.50 = 1258.32.
    const chain = [anchor, dollarPayment({ reportedBalanceCents: 125_832 })];

    expect(detectMissedMessages(chain, ratesByDay)).toEqual([]);
  });

  it('still reports the message the spread cannot explain', () => {
    // The $10 arrived, but a ₾14.45 message was lost alongside it:
    // 1285.82 − 27.00 − 14.45 = 1244.37 reported, against 1258.82 expected.
    const chain = [anchor, dollarPayment({ reportedBalanceCents: 124_437 })];

    expect(detectMissedMessages(chain, ratesByDay)).toEqual([
      {
        cardLast4: '4419',
        from: '2026-08-18',
        to: '2026-08-18',
        missingCents: 1_445,
      },
    ]);
  });

  it('reports nothing when a foreign payment has no rate for its day', () => {
    // Unknowable is not missing: with no rate the segment cannot be checked either way.
    const chain = [anchor, dollarPayment({ reportedBalanceCents: 125_882 })];

    expect(detectMissedMessages(chain)).toEqual([]);
  });

  it('chains a reading after an unverifiable segment as a fresh fixed point', () => {
    // No rate for the dollar day, but the two GEL payments after its reading still self-check —
    // and here they do not meet: 1258.82 − 6.95 = 1251.87, yet 1237.42 was reported.
    const chain = [
      anchor,
      dollarPayment({ reportedBalanceCents: 125_882 }),
      payment({
        id: 'fx2',
        cardLast4: '4419',
        amountCents: 695,
        at: '2026-08-18T13:40:00+04:00',
        reportedBalanceCents: 123_742,
        reportedBalanceCurrency: 'GEL',
      }),
    ];

    expect(detectMissedMessages(chain)).toEqual([
      {
        cardLast4: '4419',
        from: '2026-08-18',
        to: '2026-08-18',
        missingCents: 1_445,
      },
    ]);
  });

  it('chains a dollar account in dollars, converting the lari payment instead', () => {
    const chain = [
      payment({
        id: 'usd1',
        cardLast4: '9001',
        currency: 'USD',
        amountCents: 5_000,
        at: '2026-08-18T10:00:00+04:00',
        reportedBalanceCents: 100_000,
        reportedBalanceCurrency: 'USD',
      }),
      payment({
        id: 'usd2',
        cardLast4: '9001',
        currency: 'GEL',
        amountCents: 2_700,
        at: '2026-08-18T15:00:00+04:00',
        // ₾27.00 at 2.70 is $10.00: 1000.00 − 10.00 = 990.00.
        reportedBalanceCents: 99_000,
        reportedBalanceCurrency: 'USD',
      }),
    ];

    expect(detectMissedMessages(chain, ratesByDay)).toEqual([]);
  });
});
