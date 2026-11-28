'use client';

import { PostDrafts } from './post-drafts';
import clsx from 'clsx';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_WIDGET_SIZE,
  WIDGET_SIZES,
  type DashboardResponse,
  type MealSlot,
  type WidgetCard,
  type WidgetSize,
  type PortalState,
  type SocialProfile,
} from '@life-portal/shared-types';
import {
  arrangeWidgets,
  formatCents,
  moduleForPath,
} from '@life-portal/shared-domain';
import { HomeWidget } from './home-widget';
import { WidgetCarousel } from './widget-carousel';
import { LogFoodModal } from './log-food-modal';
import { PostsList } from './posts';
import { HomeFeed } from './home-feed';
import { PortalWallpaperLayer } from './portal-wallpaper';
import { useSocialApi } from '../lib/social-hooks';
import { SuggestedPages } from './follow';
import {
  EmptyState,
  ErrorNote,
  EstimateMark,
  Modal,
  Spinner,
} from './ui';
import { api } from '../lib/api';
import { RECOVERS, revalidate, useApi } from '../lib/hooks';
import { LoadProblem, LoadProblemBar } from './load-problem';
import { loadErrorKind } from '../lib/load-error';
import { mealContextNow } from '../lib/local-day';
import { useStartWorkout } from '../lib/training-offline';
import { useNutritionDay } from '../lib/nutrition-offline';


const SIZE_LABEL: Record<WidgetSize, string> = { half: 'Half', wide: 'Three quarters', full: 'Full width' };
const SIZE_SHARE: Record<WidgetSize, string> = { half: '50%', wide: '75%', full: '100%' };

export function Dashboard() {
  // Issue #34: Home reads again on its own after a failure (resume, reconnect, backoff).
  const portal = useApi<PortalState>('/portal');
  // The same read as the tab bar's photo, so the wallpaper costs no extra request.
  const me = useSocialApi<SocialProfile>(portal.data?.access.social ? '/social/me?preview=normal' : null);
  const wallpaper = me.data?.wallpaper;
  // Spec 040: a page has no widgets; its Home is the feeds.
  const isPage = !!portal.data?.page;
  const { data, error, isLoading, mutate: reload } = useApi<DashboardResponse>(isPage || !portal.data ? null : '/dashboard', RECOVERS);
  const [logging, setLogging] = useState<MealSlot | null>(null);
  const router = useRouter();
  // Play starts the plan's next workout the card names (issue #7), or an empty one.
  const { start: startWorkout, error: startError } = useStartWorkout();
  // The same key the log modal reads its rings from, so opening it costs one request.
  const { data: food } = useNutritionDay(
    logging && data ? `/nutrition?today=${data.today}&day=${data.today}` : null,
  );
  const [editing, setEditing] = useState(false);
  const [menuCard, setMenuCard] = useState<WidgetCard | null>(null);
  const [removing, setRemoving] = useState(false);
  const [pendingOrder, setPendingOrder] = useState<string[] | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  // A size just chosen shows at once; the saved one replaces it when the dashboard is read again.
  const [pendingSizes, setPendingSizes] = useState<Record<string, WidgetSize>>({});
  const cards = useMemo(() => {
    const ordered = pendingOrder ? arrangeWidgets(data?.cards ?? [], pendingOrder) : (data?.cards ?? []);
    return ordered.map((card) => (pendingSizes[card.id] ? { ...card, size: pendingSizes[card.id] } : card));
  }, [data?.cards, pendingOrder, pendingSizes]);

  async function resize(card: WidgetCard, size: WidgetSize) {
    setSaveError(null);
    setPendingSizes((current) => ({ ...current, [card.id]: size }));
    try {
      await api.put('/dashboard/size', { id: card.id, size });
      await revalidate('/dashboard');
    } catch {
      setSaveError('Could not save the new size. It will be back as it was on reload.');
    } finally {
      setPendingSizes(({ [card.id]: _done, ...rest }) => rest);
    }
  }

  const save = useCallback(async (order: string[]) => {
    setSaveError(null);
    try {
      await api.put('/dashboard/order', { order });
      await revalidate('/dashboard');
      await revalidate('/portal');
      setPendingOrder(null);
    } catch {
      setSaveError(
        'Could not save the new arrangement. It will be back where it was on reload.',
      );
    }
  }, []);

  const reset = async () => {
    setPendingOrder(null);
    await save([]);
  };

  async function removeWidget(card: WidgetCard) {
    const module = moduleForPath(card.href);
    if (!portal.data || !module) return;
    setRemoving(true);
    setSaveError(null);
    try {
      await api.put('/portal', {
        selectedModules: portal.data.selectedModules.filter(
          (id) => id !== module,
        ),
      });
      await Promise.all([revalidate('/portal'), revalidate('/dashboard')]);
      setMenuCard(null);
    } catch {
      setSaveError('Could not remove this widget. Please try again.');
    } finally {
      setRemoving(false);
    }
  }

  useEffect(() => {
    if (!editing) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setEditing(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing]);

  if (isPage) {
    return (
      <div className="mx-auto max-w-3xl">
        <h1 className="sr-only">Home</h1>
        <PostDrafts />
        {portal.data?.access.forYou ? <HomeFeed /> : null}
      </div>
    );
  }
  if ((isLoading || !portal.data) && !data) return <Spinner label="Opening Home…" />;
  if (!data) {
    if (!error) return null;
    // Home's cards mix money, stocks and work with food and training, so none of it is kept on
    // the device (spec 027). Offline, point at the parts that do work offline.
    const offline = loadErrorKind(error) === 'offline';
    return (
      <div className="pt-4">
        <LoadProblem error={error} onRetry={() => void reload()}>
          {offline && (
            <>
              <p className="mt-2 text-danger/80">Home needs a connection: its figures aren’t kept on this device.</p>
              {(portal.data?.access.training || portal.data?.access.nutrition) && (
                <p className="mt-2 flex flex-wrap gap-3">
                  {portal.data?.access.training && (
                    <Link className="underline" href="/training">
                      Training works offline
                    </Link>
                  )}
                  {portal.data?.access.nutrition && (
                    <Link className="underline" href="/nutrition">
                      Food works offline
                    </Link>
                  )}
                </p>
              )}
            </>
          )}
        </LoadProblem>
      </div>
    );
  }
  const canReadPosts =
    portal.data?.access.social &&
    portal.data.access.nutrition &&
    portal.data.access.foodPosts;

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="sr-only">Home</h1>
      {/* Your portal's wallpaper, fixed behind Home's top; the feed below is solid and slides over
          it as you scroll (owner, 2026-11-28). */}
      {wallpaper && <PortalWallpaperLayer wallpaper={wallpaper} variant="band" />}
      <div className="pb-3">
      {/* A failed refresh keeps the cards that were loaded (issue #34). */}
      {error && <LoadProblemBar error={error} onRetry={() => void reload()} />}
      {(saveError || startError) && (
        <div className="mb-3" role="alert">
          <ErrorNote message={(saveError || startError) as string} />
        </div>
      )}
      {cards.length === 0 ? (
        <div className="card p-6">
          <EmptyState message="A little space for what matters to you. Choose a module to get started." />
          <Link href="/settings/modules" className="btn-primary mt-4">
            Add widgets
          </Link>
        </div>
      ) : (
        <WidgetCarousel
          cards={cards}
          editing={editing}
          onEditingChange={setEditing}
          onOrderChange={setPendingOrder}
          onCommit={(order) => void save(order)}
        >
          {(card, state) => (
            <HomeWidget
              card={card}
              nutrition={
                card.key === 'nutrition' ? data.summaries.nutrition : undefined
              }
              state={state}
              onMenu={() => {
                setSaveError(null);
                setMenuCard(card);
              }}
              onQuickAction={
                card.quickAction?.kind === 'log-food'
                  ? () => setLogging(mealContextNow().slot)
                  : card.quickAction?.kind === 'start-workout'
                    ? () => void startWorkout(card.quickAction?.plan)
                    : card.quickAction?.kind === 'resume-workout'
                      ? () => router.push('/training')
                      : undefined
              }
            />
          )}
        </WidgetCarousel>
      )}
      </div>

      {/* Over a wallpaper the feed is solid and full width, so it slides up over the fixed picture
          as you scroll, and the picture shows only above it. It also covers the page's bottom
          padding, so the picture never peeks out under the tab bar. */}
      <div
        className={
          wallpaper
            ? // The owner's idea: the feed's own top edge fades from the page's colour to clear,
              // upwards, so the picture melts into the feed wherever it starts and as it scrolls.
              "relative -mx-[var(--page-gutter)] -mb-[calc(6rem+env(safe-area-inset-bottom))] min-h-[60vh] bg-surface px-[var(--page-gutter)] pb-[calc(6rem+env(safe-area-inset-bottom))] pt-1 before:pointer-events-none before:absolute before:-z-10 before:inset-x-0 before:bottom-full before:h-40 before:bg-gradient-to-t before:from-surface before:to-transparent before:content-['']"
            : undefined
        }
      >
      {/* Spec 032: posts written offline, before they are published. */}
      {canReadPosts && <PostDrafts />}
      {canReadPosts && portal.data?.access.forYou && <HomeFeed />}
      {canReadPosts && !portal.data?.access.forYou && (
        <section
          id="wall"
          className="mt-5 scroll-mt-20"
          aria-label="Following feed"
        >
          <div className="mb-3 flex items-center justify-between text-xs text-ink-muted">
            <h2 className="font-medium">Following</h2>
          </div>
          <div className="space-y-3">
            <SuggestedPages />
            <PostsList />
          </div>
        </section>
      )}

      {portal.data && !portal.data.setupCompleted && (
        <Link
          href="/setup"
          className="mt-5 block rounded-xl border border-border p-4 text-sm text-ink-muted hover:text-ink"
        >
          Make this portal yours ·{' '}
          {portal.data.setupStep > 0
            ? 'Continue setup'
            : 'Review your modules and privacy'}{' '}
          →
        </Link>
      )}
      {(data.attention.length > 0 || data.netPositionCents !== undefined) && (
        <details className="mt-5 rounded-xl border border-border p-4 text-sm text-ink-muted">
          <summary className="cursor-pointer">Around your portal</summary>
          {data.netPositionCents !== undefined && (
            <p className="mt-3">
              Net position:{' '}
              <strong className="text-ink">
                {formatCents(data.netPositionCents, data.displayCurrency)}
              </strong>
              <EstimateMark basis="Cash + realistic item values + shares − debts." />
            </p>
          )}
          {data.attention.map((item, index) => (
            <Link
              key={index}
              href={item.href ?? '/'}
              className="mt-3 block hover:text-accent"
            >
              {item.message} →
            </Link>
          ))}
        </details>
      )}

      {editing && (
        <div className="pointer-events-none fixed inset-x-0 bottom-16 z-40 flex justify-center p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-border bg-surface-raised/95 px-4 py-2 text-xs shadow-xl backdrop-blur">
            <span className="text-ink-muted">
              Drag widgets or use arrow keys
            </span>
            <button
              type="button"
              className="text-ink-muted hover:text-ink"
              onClick={() => void reset()}
            >
              Reset
            </button>
            <button
              type="button"
              className="btn-primary rounded-full"
              onClick={() => setEditing(false)}
            >
              Done
            </button>
          </div>
        </div>
      )}
      {menuCard && (
        <Modal
          open
          onClose={() => setMenuCard(null)}
          title={`${menuCard.title} widget`}
        >
          <div className="mb-3">
            <p className="mb-1.5 text-xs font-medium text-ink-muted">Size on Home</p>
            <div className="grid grid-cols-3 gap-2" role="group" aria-label="Size on Home">
              {WIDGET_SIZES.map((size) => {
                const current = cards.find((card) => card.id === menuCard.id)?.size ?? DEFAULT_WIDGET_SIZE;
                return (
                  <button
                    key={size}
                    type="button"
                    aria-pressed={current === size}
                    onClick={() => void resize(menuCard, size)}
                    className={clsx(
                      'flex flex-col items-center gap-1.5 rounded-xl border px-2 py-2.5 text-xs font-medium transition-colors',
                      current === size ? 'border-accent bg-accent-solid/10 text-accent' : 'border-border text-ink-muted hover:text-ink',
                    )}
                  >
                    {/* The strip in miniature: this card, and what is left for the next one. */}
                    <span className="flex h-5 w-full gap-0.5" aria-hidden>
                      <span className="rounded bg-current" style={{ width: SIZE_SHARE[size] }} />
                      {size !== 'full' && <span className="flex-1 rounded bg-current opacity-30" />}
                    </span>
                    {SIZE_LABEL[size]}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="grid gap-2">
            <button
              className="btn-ghost justify-start"
              onClick={() => {
                setMenuCard(null);
                setEditing(true);
              }}
            >
              Arrange widgets
            </button>
            <Link className="btn-ghost justify-start" href="/settings/modules">
              Add widgets
            </Link>
            <button
              className="btn-ghost justify-start text-danger"
              disabled={removing}
              onClick={() => void removeWidget(menuCard)}
            >
              {removing ? 'Removing…' : 'Remove widget'}
            </button>
          </div>
          <p className="mt-3 text-xs text-ink-faint">
            Removing a widget keeps its data. You can add it again anytime.
          </p>
          {saveError && <ErrorNote message={saveError} />}
        </Modal>
      )}
      {logging && (
        <LogFoodModal
          open
          onClose={() => setLogging(null)}
          foods={food?.foods ?? []}
          day={data.today}
          slot={logging}
        />
      )}
      </div>
    </div>
  );
}
