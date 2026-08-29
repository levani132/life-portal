/**
 * Bank SMS parsers (constitution principle V — pure, no clock, no I/O).
 *
 * Both banks are parsed **keyword-first**: a value is only read from a line whose keyword says
 * what that value is. The alternative — scanning a message for numbers and taking them in order,
 * or taking the last number on a line — reads a loyalty-points line as money. Both banks print
 * one, and the owner's real messages are the fixtures that prove it:
 *
 *   BOG  `სულ: 1,975.28 PLUS`            — PLUS points, not lari, not a balance.
 *   TBC  `Ertgul kulabashi gaqvs: 10.14GEL` — a loyalty pot, priced in GEL but not spendable.
 *
 * Reading either as an amount would inflate reported spending by a factor of a hundred; reading
 * one as a balance would make the completeness check (`detectMissedMessages`) invent gaps forever.
 * So nothing here has a "find the number" fallback, and every parser returns `null` rather than a
 * half-filled object — the caller stores the raw text as `unparsed` and asks the owner. A payment
 * recorded wrong is worse than one obviously missing.
 */
import type { Cents, Currency, IsoDate } from '@life-portal/shared-types';
import { SUPPORTED_CURRENCIES } from '@life-portal/shared-types';
import { toCents } from './money';

export interface ParsedMessage {
  direction: 'out' | 'in';
  /** Absent only when unreadable — and an unreadable amount makes the whole parse `null`. */
  amountCents?: Cents;
  currency?: Currency;
  merchant?: string;
  cardLast4?: string;
  /**
   * The moment the bank printed, when it printed one. TBC does; BOG prints a bare date.
   *
   * A BOG message therefore yields a date-only `YYYY-MM-DD` rather than a fabricated midnight:
   * the ingest layer applies `localDay` and must be able to tell a real time from an invented one.
   */
  statedAt?: IsoDate;
  /** TBC's `Nashti`. One account of several, so it is a completeness check — never a balance. */
  reportedBalanceCents?: Cents;
  /** TBC's `dagibrunda`. Accrues to the loyalty pot, not the account: recorded, then ignored. */
  cashbackCents?: Cents;
}

/**
 * A decimal with optional thousands separators. Anchored at both ends so a keyword line has to be
 * *entirely* an amount — `1,975.28 PLUS` fails, which is the point.
 */
const DECIMAL = /^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?$/;

function parseAmountCents(text: string): Cents | null {
  const trimmed = text.trim();
  if (!DECIMAL.test(trimmed)) return null;
  const value = Number(trimmed.replace(/,/g, ''));
  if (!Number.isFinite(value)) return null;
  return toCents(value);
}

function asCurrency(code: string): Currency | null {
  const upper = code.toUpperCase() as Currency;
  return SUPPORTED_CURRENCIES.includes(upper) ? upper : null;
}

function lines(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** `Georgian Coffee Group>Tbilisi GE` is one merchant plus its city; only the name is shown. */
function cleanMerchant(text: string): string | undefined {
  const name = text.split('>')[0].trim();
  return name.length > 0 ? name : undefined;
}

// --- BOG: Georgian, currency prefix, date only, no time ------------------------------------

/** `გადახდა: GEL4.00` (out) or `ჩარიცხვა: GEL185.46` (in). The keyword carries the direction. */
const BOG_AMOUNT = /^(გადახდა|ჩარიცხვა)\s*:\s*([A-Za-z]{3})\s*([\d,.]+)$/;
const BOG_CARD = /^Card\s*:\s*\**(\d{4})$/i;
const BOG_DATE = /^(\d{2})\.(\d{2})\.(\d{4})$/;
/** `დაგერიცხა:` (points earned) and `სულ:` (points total) are PLUS points. Never money. */
const BOG_LOYALTY = /^(დაგერიცხა|სულ)\s*:/;

function isBogNoise(line: string): boolean {
  return (
    BOG_LOYALTY.test(line) ||
    BOG_DATE.test(line) ||
    BOG_CARD.test(line) ||
    BOG_AMOUNT.test(line)
  );
}

export function parseBogMessage(raw: string): ParsedMessage | null {
  if (typeof raw !== 'string') return null;
  const rows = lines(raw);

  const amountIndex = rows.findIndex((line) => BOG_AMOUNT.test(line));
  if (amountIndex < 0) return null;

  const [, keyword, code, figure] = BOG_AMOUNT.exec(
    rows[amountIndex],
  ) as RegExpExecArray;
  const amountCents = parseAmountCents(figure);
  const currency = asCurrency(code);
  // An amount we cannot denominate is not a recognised payment; guessing GEL would be a lie.
  if (amountCents === null || currency === null) return null;

  const parsed: ParsedMessage = {
    direction: keyword === 'ჩარიცხვა' ? 'in' : 'out',
    amountCents,
    currency,
  };

  const cardIndex = rows.findIndex((line) => BOG_CARD.test(line));
  if (cardIndex >= 0) {
    parsed.cardLast4 = (BOG_CARD.exec(rows[cardIndex]) as RegExpExecArray)[1];
  }

  // The merchant is the line after the card line; a credit has no card line, and there the line
  // after the amount is the counterparty. Either way it must not be one of the known lines.
  const merchantIndex = (cardIndex >= 0 ? cardIndex : amountIndex) + 1;
  const merchantLine = rows[merchantIndex];
  if (merchantLine && !isBogNoise(merchantLine)) {
    parsed.merchant = cleanMerchant(merchantLine);
  }

  const dateLine = rows.find((line) => BOG_DATE.test(line));
  if (dateLine) {
    const [, day, month, year] = BOG_DATE.exec(dateLine) as RegExpExecArray;
    parsed.statedAt = `${year}-${month}-${day}`;
  }

  return parsed;
}

// --- TBC: transliterated Latin, currency suffix, with a time -------------------------------

/** `186.48GEL` on the first line, with no keyword at all — the shape itself is the anchor. */
const TBC_AMOUNT = /^([\d,.]+)\s*([A-Za-z]{3})$/;
const TBC_CARD = /^\(\*(\d{4})\)$/;
/** `Nashti:` is the account balance after the payment. */
const TBC_BALANCE = /^Nashti\s*:\s*([\d,.]+)\s*[A-Za-z]{3}$/i;
/** `dagibrunda:` is cashback into the loyalty pot — verified never to move `Nashti`. */
const TBC_CASHBACK = /^dagibrunda\s*:\s*([\d,.]+)\s*[A-Za-z]{3}$/i;
/** `Ertgul kulabashi gaqvs:` is the loyalty balance. Matched only so it is never a merchant. */
const TBC_LOYALTY = /^Ertgul\s+kulabashi\s+gaqvs\s*:/i;
const TBC_DATE = /^(\d{2})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})$/;

function isTbcNoise(line: string): boolean {
  return (
    TBC_BALANCE.test(line) ||
    TBC_CASHBACK.test(line) ||
    TBC_LOYALTY.test(line) ||
    TBC_DATE.test(line) ||
    TBC_CARD.test(line)
  );
}

export function parseTbcMessage(raw: string): ParsedMessage | null {
  if (typeof raw !== 'string') return null;
  const rows = lines(raw);
  if (rows.length === 0) return null;

  // Only the *first* line may be the amount. Anywhere else, a bare `10.14GEL` is a loyalty figure.
  const head = TBC_AMOUNT.exec(rows[0]);
  if (!head) return null;

  const amountCents = parseAmountCents(head[1]);
  const currency = asCurrency(head[2]);
  if (amountCents === null || currency === null) return null;

  // TBC's payment format has no inbound variant; a credit arrives in a different shape entirely
  // and falls through to `unparsed` rather than being recorded as spending.
  const parsed: ParsedMessage = { direction: 'out', amountCents, currency };

  const cardIndex = rows.findIndex((line) => TBC_CARD.test(line));
  if (cardIndex >= 0) {
    parsed.cardLast4 = (TBC_CARD.exec(rows[cardIndex]) as RegExpExecArray)[1];
  }

  const merchantLine = rows[(cardIndex >= 0 ? cardIndex : 0) + 1];
  if (
    merchantLine &&
    !isTbcNoise(merchantLine) &&
    !TBC_AMOUNT.test(merchantLine)
  ) {
    parsed.merchant = cleanMerchant(merchantLine);
  }

  const balanceLine = rows.find((line) => TBC_BALANCE.test(line));
  if (balanceLine) {
    const cents = parseAmountCents(
      (TBC_BALANCE.exec(balanceLine) as RegExpExecArray)[1],
    );
    if (cents !== null) parsed.reportedBalanceCents = cents;
  }

  const cashbackLine = rows.find((line) => TBC_CASHBACK.test(line));
  if (cashbackLine) {
    const cents = parseAmountCents(
      (TBC_CASHBACK.exec(cashbackLine) as RegExpExecArray)[1],
    );
    if (cents !== null) parsed.cashbackCents = cents;
  }

  const dateLine = rows.find((line) => TBC_DATE.test(line));
  if (dateLine) {
    const [, day, month, year, hour, minute] = TBC_DATE.exec(
      dateLine,
    ) as RegExpExecArray;
    // Wall-clock as the bank printed it, with no offset appended: the message carries no zone, and
    // stamping `Z` on it would move a late-evening payment onto the wrong day.
    parsed.statedAt = `20${year}-${month}-${day}T${hour}:${minute}:00`;
  }

  return parsed;
}

/**
 * Parses a message from the named bank, or tries both when the sender is unknown.
 *
 * The two formats cannot both match: BOG needs a Georgian keyword line, TBC needs a bare
 * `amount+currency` first line. So trying both is a lookup, not a guess.
 */
export function parseBankMessage(
  raw: string,
  bank?: 'bog' | 'tbc',
): ParsedMessage | null {
  if (bank === 'bog') return parseBogMessage(raw);
  if (bank === 'tbc') return parseTbcMessage(raw);
  return parseBogMessage(raw) ?? parseTbcMessage(raw);
}
