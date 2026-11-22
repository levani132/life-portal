import {
  USAGE_KINDS,
  USAGE_RETENTION_STEPS,
  USAGE_RETENTION_WINDOW_DAYS,
  type UsageKind,
  type UsageRange,
  type UsageReport,
} from '@life-portal/shared-types';
import { addDays } from './dates';

/** One thing one person did on one day. The id is only used to count distinct people. */
export interface UsageEvent {
  userId: string;
  day: string;
  kind: UsageKind;
}

export interface UsageInput {
  today: string;
  range: UsageRange;
  totalAccounts: number;
  /** Accounts created in the look-back window: who, and the day. */
  signups: { userId: string; day: string }[];
  /** Activity in the look-back window. */
  events: UsageEvent[];
}

/**
 * The usage report: pure, with "today" passed in. It counts distinct people per day and per
 * window, and never returns an id.
 *
 * "Active" means the person did something that leaves a record: logged food or a weigh-in,
 * trained, posted, commented, liked or sent a message. Opening the app without doing anything
 * is not recorded anywhere, so it is not counted.
 */
export function usageReport(input: UsageInput): UsageReport {
  const { today, range } = input;
  const from = addDays(today, -(range - 1));
  const inRange = (day: string) => day >= from && day <= today;
  const since = (days: number) => addDays(today, -(days - 1));

  const byDay = new Map<string, Map<UsageKind | 'any', Set<string>>>();
  const mark = (day: string, kind: UsageKind | 'any', userId: string) => {
    let kinds = byDay.get(day);
    if (!kinds) byDay.set(day, (kinds = new Map()));
    let people = kinds.get(kind);
    if (!people) kinds.set(kind, (people = new Set()));
    people.add(userId);
  };
  /** Each person's days of activity, for "came back". */
  const lastActive = new Map<string, string>();
  for (const event of input.events) {
    if (event.day > today) continue;
    mark(event.day, event.kind, event.userId);
    mark(event.day, 'any', event.userId);
    if ((lastActive.get(event.userId) ?? '') < event.day) lastActive.set(event.userId, event.day);
  }

  const distinct = (fromDay: string, kind: UsageKind | 'any') => {
    const people = new Set<string>();
    for (const [day, kinds] of byDay) {
      if (day < fromDay || day > today) continue;
      for (const userId of kinds.get(kind) ?? []) people.add(userId);
    }
    return people;
  };
  const count = (day: string, kind: UsageKind | 'any') => byDay.get(day)?.get(kind)?.size ?? 0;

  const signupsByDay = new Map<string, number>();
  for (const signup of input.signups) signupsByDay.set(signup.day, (signupsByDay.get(signup.day) ?? 0) + 1);

  const days = Array.from({ length: range }, (_, index) => {
    const day = addDays(from, index);
    return {
      day,
      newAccounts: signupsByDay.get(day) ?? 0,
      active: count(day, 'any'),
      food: count(day, 'food'),
      training: count(day, 'training'),
      posted: count(day, 'post'),
    };
  });

  const newInRange = input.signups.filter((signup) => inRange(signup.day));
  const everActive = distinct('0000-00-00', 'any');
  const windowStart = addDays(today, -(USAGE_RETENTION_WINDOW_DAYS - 1));
  const retention = USAGE_RETENTION_STEPS.map((afterDays) => {
    const eligible = input.signups.filter((signup) => signup.day >= windowStart && addDays(signup.day, afterDays) <= today);
    const returned = eligible.filter((signup) => (lastActive.get(signup.userId) ?? '') >= addDays(signup.day, afterDays));
    return { afterDays, eligible: eligible.length, returned: returned.length };
  });

  return {
    range,
    today,
    totalAccounts: input.totalAccounts,
    newAccounts: newInRange.length,
    activeToday: count(today, 'any'),
    active7: distinct(since(7), 'any').size,
    active30: distinct(since(30), 'any').size,
    people: Object.fromEntries(USAGE_KINDS.map((kind) => [kind, distinct(from, kind).size])) as Record<UsageKind, number>,
    newAccountsActivated: newInRange.filter((signup) => everActive.has(signup.userId)).length,
    retention,
    days,
  };
}
