'use client';

import clsx from 'clsx';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { PostsList } from './posts';

/**
 * Home's feed with the `forYou` flag (issue #1): For You (public discovery, spec 018) and
 * Friends (the existing Wall, unchanged). "Friends", not "Following": friendship is mutual and
 * there is no one-way follow yet.
 *
 * Both lists stay mounted once opened, so each keeps its own page, paging history and loaded
 * posts. The window scrolls the page; when the strip is pinned, switching restores the other
 * tab's own scroll position (or the top of the feed the first time). The strip is tap and
 * keyboard only, and marked `data-no-tab-swipe`, so it never fights the app's tab swiping.
 */
export const FEED_TABS = [
  { id: 'forYou', label: 'For You' },
  { id: 'friends', label: 'Friends' },
] as const;
export type FeedTab = (typeof FEED_TABS)[number]['id'];
const STORAGE_KEY = 'home-feed-tab';

function storedTab(): FeedTab | null {
  try {
    const value = sessionStorage.getItem(STORAGE_KEY);
    return value === 'forYou' || value === 'friends' ? value : null;
  } catch {
    return null;
  }
}

export function HomeFeed() {
  const [tab, setTab] = useState<FeedTab>('forYou');
  const [opened, setOpened] = useState<Set<FeedTab>>(() => new Set(['forYou']));
  const section = useRef<HTMLElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const scrolls = useRef<Partial<Record<FeedTab, number>>>({});
  const pending = useRef(false);

  // The session's last choice. Read after mount: the server render cannot see sessionStorage.
  useEffect(() => {
    const stored = storedTab();
    if (stored && stored !== 'forYou') {
      setTab(stored);
      setOpened((set) => new Set(set).add(stored));
    }
  }, []);

  /** The window scroll at which the strip becomes pinned under the header. */
  const pinAt = useCallback(() => {
    const node = section.current;
    const bar = strip.current;
    if (!node || !bar) return 0;
    return (
      node.getBoundingClientRect().top +
      window.scrollY -
      parseFloat(getComputedStyle(bar).top || '0')
    );
  }, []);

  const select = useCallback(
    (next: FeedTab) => {
      if (next === tab) return;
      scrolls.current[tab] = window.scrollY;
      pending.current = true;
      setTab(next);
      setOpened((set) => (set.has(next) ? set : new Set(set).add(next)));
      try {
        sessionStorage.setItem(STORAGE_KEY, next);
      } catch {
        // Private mode: the choice just isn't remembered.
      }
    },
    [tab],
  );

  // After the switch renders, before paint: if the feed was scrolled into, land where this tab
  // was left (never above the pinned strip). Above that, the widgets are shared, so stay put.
  useLayoutEffect(() => {
    if (!pending.current) return;
    pending.current = false;
    const pin = pinAt();
    // Sitting exactly on the pinned strip counts as being in the feed (a pixel of rounding).
    if (window.scrollY >= pin - 1)
      window.scrollTo(0, Math.max(pin, scrolls.current[tab] ?? pin));
  }, [tab, pinAt]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = FEED_TABS.findIndex((t) => t.id === tab);
    const step =
      event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    const target =
      event.key === 'Home'
        ? FEED_TABS[0]
        : event.key === 'End'
          ? FEED_TABS[FEED_TABS.length - 1]
          : step
            ? FEED_TABS[(index + step + FEED_TABS.length) % FEED_TABS.length]
            : null;
    if (!target) return;
    event.preventDefault();
    select(target.id);
    strip.current
      ?.querySelector<HTMLButtonElement>(`#feed-tab-${target.id}`)
      ?.focus();
  }

  return (
    <section ref={section} id="wall" className="mt-5" aria-label="Feed">
      <div
        ref={strip}
        role="tablist"
        aria-label="Feed"
        data-no-tab-swipe
        onKeyDown={onKeyDown}
        className="sticky top-[var(--header-offset,var(--top-chrome))] z-30 -mx-4 mb-3 flex gap-6 border-b border-border bg-surface/95 px-4 backdrop-blur transition-[top] duration-200"
      >
        {FEED_TABS.map((t) => {
          const selected = t.id === tab;
          return (
            <button
              key={t.id}
              id={`feed-tab-${t.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`feed-panel-${t.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => select(t.id)}
              className={clsx(
                '-mb-px border-b-2 py-2.5 text-sm font-medium transition-colors',
                selected
                  ? 'border-accent text-ink'
                  : 'border-transparent text-ink-muted hover:text-ink',
              )}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      {FEED_TABS.map((t) => (
        <div
          key={t.id}
          id={`feed-panel-${t.id}`}
          role="tabpanel"
          aria-labelledby={`feed-tab-${t.id}`}
          hidden={t.id !== tab}
          // At least a screen tall, so a tab that is still loading (or short) can stay scrolled
          // to the pinned strip instead of the page snapping back up to the widgets.
          className="min-h-screen"
        >
          {opened.has(t.id) &&
            (t.id === 'forYou' ? (
              <PostsList
                feed="forYou"
                empty={
                  <div className="card space-y-3 p-6 text-sm text-ink-muted">
                    <p>
                      Nothing to discover yet. Public posts from people who chose to
                      be found will show up here.
                    </p>
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => select('friends')}
                    >
                      See posts from your friends
                    </button>
                  </div>
                }
              />
            ) : (
              <PostsList />
            ))}
        </div>
      ))}
    </section>
  );
}
