/**
 * Error monitoring: what went wrong in production, counted, for the developer. A record holds a
 * scrubbed message and a place (a route pattern or a page), never who it happened to.
 */
export type ErrorSource = 'api' | 'web';

export const ERROR_RANGES = [1, 7, 30] as const;
export type ErrorRange = (typeof ERROR_RANGES)[number];

/** One kind of error over the chosen days. */
export interface ErrorGroup {
  fingerprint: string;
  source: ErrorSource;
  name: string;
  message: string;
  /** A route pattern (`GET /posts/:id`) or a page (`/nutrition`). */
  where: string;
  /** The HTTP status answered, for an API error. */
  status?: number;
  count: number;
  firstDay: string;
  lastDay: string;
  lastAt: string;
  /** The top of the most recent stack, scrubbed. */
  stack?: string;
}

export interface ErrorReport {
  range: ErrorRange;
  total: number;
  groups: ErrorGroup[];
}

/** What the web app sends when something breaks on the page. */
export interface ClientErrorInput {
  name: string;
  message: string;
  stack?: string;
  page: string;
}
