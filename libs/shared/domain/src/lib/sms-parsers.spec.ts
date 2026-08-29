import {
  parseBankMessage,
  parseBogMessage,
  parseTbcMessage,
} from './sms-parsers';

/** Verbatim from the owner's phone. If a bank changes its wording, one of these fails. */
const BOG_PAYMENT = `გადახდა: GEL4.00
Card:***9582
Georgian Coffee Group>Tbilisi GE
23.08.2026`;

const BOG_PAYMENT_WITH_POINTS = `გადახდა: GEL17.79
Card:***9582
Fresco
დაგერიცხა: 35.58 PLUS
სულ: 1,975.28 PLUS
23.08.2026`;

const BOG_CREDIT = `ჩარიცხვა: GEL185.46
იმ ანი ბეროშვილი
24.08.2026`;

const TBC_PAYMENT = `186.48GEL
(*6810)
Gulfclub
Nashti: 1285.82GEL
dagibrunda: 0.93GEL
Ertgul kulabashi gaqvs: 10.14GEL
23/08/26 23:38`;

describe('parseBogMessage', () => {
  it('reads a card payment, stripping the city from the merchant', () => {
    expect(parseBogMessage(BOG_PAYMENT)).toEqual({
      direction: 'out',
      amountCents: 400,
      currency: 'GEL',
      merchant: 'Georgian Coffee Group',
      cardLast4: '9582',
      statedAt: '2026-08-23',
    });
  });

  it('never reads a PLUS loyalty line as an amount or a balance', () => {
    const parsed = parseBogMessage(BOG_PAYMENT_WITH_POINTS);
    // 35.58 and 1,975.28 are points. Only the GEL17.79 on the keyword line is money.
    expect(parsed).toEqual({
      direction: 'out',
      amountCents: 1779,
      currency: 'GEL',
      merchant: 'Fresco',
      cardLast4: '9582',
      statedAt: '2026-08-23',
    });
    expect(parsed?.reportedBalanceCents).toBeUndefined();
    expect(parsed?.amountCents).not.toBe(197528);
    expect(parsed?.amountCents).not.toBe(3558);
  });

  it('records an incoming credit as direction "in", with the sender as the merchant', () => {
    expect(parseBogMessage(BOG_CREDIT)).toEqual({
      direction: 'in',
      amountCents: 18546,
      currency: 'GEL',
      merchant: 'იმ ანი ბეროშვილი',
      statedAt: '2026-08-24',
    });
  });

  it('gives a date-only statedAt, because BOG prints no time', () => {
    expect(parseBogMessage(BOG_PAYMENT)?.statedAt).toBe('2026-08-23');
  });

  it('handles a thousands separator in the amount itself', () => {
    const parsed = parseBogMessage(
      'გადახდა: GEL1,975.28\nCard:***9582\nFresco\n23.08.2026',
    );
    expect(parsed?.amountCents).toBe(197528);
  });

  it('returns null when the amount line is missing', () => {
    expect(parseBogMessage('Card:***9582\nFresco\n23.08.2026')).toBeNull();
  });

  it('returns null for an unsupported currency rather than guessing lari', () => {
    expect(
      parseBogMessage('გადახდა: XYZ4.00\nCard:***9582\nFresco'),
    ).toBeNull();
  });

  it('returns null for garbage', () => {
    expect(parseBogMessage('Your OTP is 4821')).toBeNull();
    expect(parseBogMessage('')).toBeNull();
  });
});

describe('parseTbcMessage', () => {
  it('reads the keyword-less first line as the amount', () => {
    expect(parseTbcMessage(TBC_PAYMENT)).toEqual({
      direction: 'out',
      amountCents: 18648,
      currency: 'GEL',
      merchant: 'Gulfclub',
      cardLast4: '6810',
      reportedBalanceCents: 128582,
      cashbackCents: 93,
      statedAt: '2026-08-23T23:38:00',
    });
  });

  it('keeps cashback distinct from the amount and never nets it off', () => {
    const parsed = parseTbcMessage(TBC_PAYMENT);
    // dagibrunda accrues to the loyalty pot: 10.14 +0.93 never moves Nashti.
    expect(parsed?.cashbackCents).toBe(93);
    expect(parsed?.amountCents).toBe(18648);
    expect(parsed?.amountCents).not.toBe(18648 - 93);
  });

  it('ignores the loyalty balance entirely', () => {
    const parsed = parseTbcMessage(TBC_PAYMENT);
    // 10.14GEL is `Ertgul kulabashi gaqvs` — not the balance, not the merchant, not the amount.
    expect(parsed?.reportedBalanceCents).toBe(128582);
    expect(parsed?.merchant).toBe('Gulfclub');
    expect(parsed?.amountCents).toBe(18648);
  });

  it('parses a thousands separator in Nashti', () => {
    const parsed = parseTbcMessage(
      '6.95GEL\n(*6810)\nmcdonald s draivi\nNashti: 1,278.87GEL\n24/08/26 09:05',
    );
    expect(parsed?.reportedBalanceCents).toBe(127887);
    expect(parsed?.amountCents).toBe(695);
    expect(parsed?.merchant).toBe('mcdonald s draivi');
  });

  it('keeps a messy merchant verbatim', () => {
    const parsed = parseTbcMessage(
      '22.19GEL\n(*6810)\nFENIX 222 LLC\nNashti: 1242.23GEL',
    );
    expect(parsed?.merchant).toBe('FENIX 222 LLC');
    expect(parsed?.statedAt).toBeUndefined();
  });

  it('returns null when the first line is not an amount', () => {
    expect(
      parseTbcMessage('(*6810)\nGulfclub\nNashti: 1285.82GEL\n23/08/26 23:38'),
    ).toBeNull();
  });

  it('returns null for garbage', () => {
    expect(parseTbcMessage('TBC: your statement is ready')).toBeNull();
    expect(parseTbcMessage('   ')).toBeNull();
  });
});

describe('parseBankMessage', () => {
  it('uses the named bank', () => {
    expect(parseBankMessage(BOG_PAYMENT, 'bog')?.amountCents).toBe(400);
    expect(parseBankMessage(TBC_PAYMENT, 'tbc')?.amountCents).toBe(18648);
  });

  it('returns null when the named bank does not recognise the message', () => {
    expect(parseBankMessage(TBC_PAYMENT, 'bog')).toBeNull();
    expect(parseBankMessage(BOG_PAYMENT, 'tbc')).toBeNull();
  });

  it('tries both when the sender is unknown', () => {
    expect(parseBankMessage(BOG_PAYMENT)?.cardLast4).toBe('9582');
    expect(parseBankMessage(TBC_PAYMENT)?.cardLast4).toBe('6810');
    expect(parseBankMessage('Your OTP is 4821')).toBeNull();
  });
});
