import type { BoardSummary } from './boards';
import type { CashflowSummary } from './cashflow';
import type { Cents, IsoDate } from './common';
import type { ItemsSummary } from './items';
import type { LoansSummary } from './loans';
import type { PersonalSummary } from './personal';
import type { StocksSummary } from './stocks';

/**
 * The dashboard is a registry of cards. Adding a widget means adding a `WidgetKey` and a
 * summary — never editing another widget (constitution principle I).
 */
export const WIDGET_KEYS = [
  'loans',
  'cashflow',
  'items',
  'stocks',
  'board',
  'personal',
] as const;
export type WidgetKey = (typeof WIDGET_KEYS)[number];

/** Severity of the card's headline, used for the accent and the sort. */
export type WidgetTone = 'neutral' | 'good' | 'warn' | 'bad';

/** One number on a summary card. Cards show at most three (constitution principle I). */
export interface WidgetStat {
  label: string;
  /** Pre-formatted for display, e.g. `$10,500`, `12 days`, `3 / 8`. */
  value: string;
  /** Raw value for sorting and sparklines. */
  raw?: number;
  tone?: WidgetTone;
  /** Marks a value the system estimated rather than recorded. */
  estimated?: boolean;
}

export interface WidgetCard {
  key: WidgetKey;
  /** Unique per card: `loans`, `board:epam`, … Used as the React key and the deep link. */
  id: string;
  title: string;
  subtitle?: string;
  href: string;
  icon: string;
  accent: string;
  tone: WidgetTone;
  stats: WidgetStat[];
  /** Optional progress bar, 0-1. */
  progress?: number;
  /** Short call-to-action line, e.g. "2 people need attention". */
  alert?: string;
  order: number;
}

export interface DashboardResponse {
  generatedAt: IsoDate;
  /** Reference "today" used for every projection in this payload. */
  today: IsoDate;
  cards: WidgetCard[];
  /** Headline net-worth-ish figure: cash + items + stocks − debts. */
  netPositionCents: Cents;
  displayCurrency: string;
  summaries: {
    loans: LoansSummary;
    cashflow: CashflowSummary;
    items: ItemsSummary;
    stocks: StocksSummary;
    boards: BoardSummary[];
    personal: PersonalSummary;
  };
  /** Cross-widget nudges, e.g. "salary lands in 4 days" or "quotes are 6 days stale". */
  attention: { tone: WidgetTone; message: string; href?: string }[];
}
