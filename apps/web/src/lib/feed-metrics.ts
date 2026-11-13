'use client';
import { createContext, useContext, useEffect, useRef, useState, type RefObject } from 'react';
import type { FeedMetricEvent, FeedMetricInput, FeedMetricsBatch } from '@life-portal/shared-types';
import { FEED_METRICS_CONFIG } from '@life-portal/shared-domain';
import { API_URL, tokens } from './api';

/**
 * For You measurement in the browser (#11). Runs only when the API says measurement is active
 * for this account (`forYouMetrics` on and not opted out); otherwise nothing here is created.
 * Events are queued and sent every 15 s and when the page is hidden or left. Sending is fire and
 * forget: a lost batch is a lost count, never a retry loop, an error or a refresh of other data.
 */
export class FeedMetricsTracker {
  private queue: FeedMetricInput[] = [];
  private readonly seen = new Set<string>();
  private visit = true;
  private timer?: ReturnType<typeof setInterval>;
  private readonly onHide = () => {
    if (document.visibilityState === 'hidden') this.flush();
  };
  private readonly onLeave = () => this.flush();

  constructor(private readonly send: (batch: FeedMetricsBatch) => void = sendBatch) {}

  /** Once per post and event per page load; the server de-duplicates per day as well. */
  record(postId: string, type: FeedMetricEvent) {
    const key = `${postId}:${type}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.queue.push({ postId, type });
    if (this.queue.length >= FEED_METRICS_CONFIG.maxBatch) this.flush();
  }

  flush() {
    if (!this.queue.length && !this.visit) return;
    const events = this.queue.splice(0, FEED_METRICS_CONFIG.maxBatch);
    this.send(this.visit ? { events, visit: true } : { events });
    this.visit = false;
  }

  start() {
    this.timer = setInterval(() => this.flush(), FEED_METRICS_CONFIG.flushMs);
    document.addEventListener('visibilitychange', this.onHide);
    window.addEventListener('pagehide', this.onLeave);
  }

  /** Sends what is queued, unless measurement was just switched off (`discard`). */
  stop(discard = false) {
    clearInterval(this.timer);
    document.removeEventListener('visibilitychange', this.onHide);
    window.removeEventListener('pagehide', this.onLeave);
    if (discard) this.queue = [];
    else this.flush();
  }
}

/** `keepalive` lets the last batch outlive the page; `sendBeacon` cannot carry the token. */
function sendBatch(batch: FeedMetricsBatch) {
  const access = tokens.access;
  if (!access) return;
  void fetch(`${API_URL}/posts/for-you/metrics/events`, {
    method: 'POST',
    keepalive: true,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${access}` },
    body: JSON.stringify(batch),
  }).catch(() => undefined);
}

/** A tracker for the page while `active`, or `null`. */
export function useFeedMetricsTracker(active: boolean) {
  const [tracker, setTracker] = useState<FeedMetricsTracker | null>(null);
  // Read in the cleanup: false there means opted out (drop the queue), true means unmounting.
  const stillActive = useRef(active);
  stillActive.current = active;
  useEffect(() => {
    if (!active) return;
    const next = new FeedMetricsTracker();
    next.start();
    setTracker(next);
    return () => {
      next.stop(!stillActive.current);
      setTracker(null);
    };
  }, [active]);
  return tracker;
}

export const FeedMetricsContext = createContext<FeedMetricsTracker | null>(null);

/** The post a card's events belong to; absent outside For You or without measurement. */
export const PostMetricsContext = createContext<((type: FeedMetricEvent) => void) | null>(null);
export const usePostMetrics = () => useContext(PostMetricsContext);

/**
 * Calls `onSeen` once when at least half the element (or half the screen, for a card taller than
 * that) has been on screen for a second.
 */
export function useImpression(element: RefObject<HTMLElement | null>, onSeen: (() => void) | null) {
  const callback = useRef(onSeen);
  callback.current = onSeen;
  const enabled = !!onSeen;
  useEffect(() => {
    const node = element.current;
    if (!enabled || !node || typeof IntersectionObserver === 'undefined') return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new IntersectionObserver(
      ([entry]) => {
        const visible =
          entry.intersectionRatio >= FEED_METRICS_CONFIG.visibleRatio ||
          entry.intersectionRect.height >= window.innerHeight * FEED_METRICS_CONFIG.visibleRatio;
        clearTimeout(timer);
        if (!visible) return;
        timer = setTimeout(() => {
          callback.current?.();
          observer.disconnect();
        }, FEED_METRICS_CONFIG.visibleMs);
      },
      { threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    observer.observe(node);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [element, enabled]);
}
