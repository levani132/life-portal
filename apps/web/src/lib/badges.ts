'use client';

import { useEffect } from 'react';
import type { BadgeCheckResult } from '@life-portal/shared-types';
import { api, onSuccessfulWrite } from './api';
import { revalidate, useApi } from './hooks';
import { todayLocal } from './local-day';

/**
 * Profile badges (spec 022). There is no event bus on the API, so the browser asks for an
 * evaluation after an action that can complete a badge (research R4). Fire-and-forget, at most
 * once per 30 s per tab; anything missed is caught the next time the collection opens.
 */
const THROTTLE_MS = 30_000;
let lastCheck = 0;
let dayStartHour = 4;
/** Badges a background check awarded in this tab, so the collection can still mark them new. */
const recentlyEarned = new Set<string>();

export function earnedThisSession(badgeId: string): boolean {
  return recentlyEarned.has(badgeId);
}

/** The key the collection is fetched under, with the eater's day. */
export function myBadgesKey(): string {
  return `/badges/me?today=${todayLocal(dayStartHour)}`;
}

let trailing: ReturnType<typeof setTimeout> | null = null;

/** Throttled with a trailing call, so an action right after another is checked, just later. */
export function checkBadges(): void {
  const wait = lastCheck + THROTTLE_MS - Date.now();
  if (wait > 0) {
    trailing ??= setTimeout(() => {
      trailing = null;
      checkBadges();
    }, wait);
    return;
  }
  lastCheck = Date.now();
  void api
    .post<BadgeCheckResult>(`/badges/check?today=${todayLocal(dayStartHour)}`)
    .then((result) => {
      if (!result.newBadgeIds.length) return;
      result.newBadgeIds.forEach((id) => recentlyEarned.add(id));
      void revalidate('/badges');
    })
    .catch(() => undefined);
}

/**
 * Mounted once by the shell: learns the Food day-start hour (default 4 without Food) and checks
 * once when the app starts, which also picks up meals logged through MCP or a Shortcut.
 */
export function useBadgeCheckOnStart(enabled: boolean, hasFood: boolean): void {
  const { data, error } = useApi<{ profile: { dayStartHour: number } }>(
    enabled && hasFood ? '/nutrition/profile' : null,
    { shouldRetryOnError: false },
  );
  const ready = enabled && (!hasFood || !!data || !!error);
  useEffect(() => {
    if (!ready) return;
    if (data) dayStartHour = data.profile.dayStartHour;
    checkBadges();
  }, [ready, data]);
}

/**
 * Writes that can complete a badge: logging a meal by any route, publishing a post, finishing a
 * workout. Friend accepts are checked by the connection actions, which know the action.
 */
const QUALIFYING: RegExp[] = [
  /^\/nutrition\/entries(\/repeat)?$/,
  /^\/nutrition\/meals\/[^/]+\/log$/,
  /^\/nutrition\/cheat\/[^/]+\/log$/,
  /^\/posts$/,
  /^\/training\/sessions\/[^/]+\/finish$/,
];
onSuccessfulWrite((method, path) => {
  if (method === 'POST' && QUALIFYING.some((pattern) => pattern.test(path.split('?')[0]))) {
    checkBadges();
  }
});
