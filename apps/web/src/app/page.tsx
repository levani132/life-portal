'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  DashboardResponse,
  FoodWithUsage,
  MealSlot,
  WidgetCard,
  PortalState,
} from '@life-portal/shared-types';
import {
  arrangeWidgets,
  formatCents,
  moduleForPath,
} from '@life-portal/shared-domain';
import { AppShell } from '../components/app-shell';
import { HomeWidget } from '../components/home-widget';
import { WidgetCarousel } from '../components/widget-carousel';
import { LogFoodModal } from '../components/log-food-modal';
import { PostsList } from '../components/posts';
import {
  EmptyState,
  ErrorNote,
  EstimateMark,
  Modal,
  Spinner,
} from '../components/ui';
import { api } from '../lib/api';
import { revalidate, useApi } from '../lib/hooks';
import { mealContextNow } from '../lib/local-day';

export default function DashboardPage() {
  return (
    <AppShell>
      <Dashboard />
    </AppShell>
  );
}

function Dashboard() {
  const { data, error, isLoading } = useApi<DashboardResponse>('/dashboard');
  const portal = useApi<PortalState>('/portal');
  const [logging, setLogging] = useState<MealSlot | null>(null);
  const { data: food } = useApi<{ foods: FoodWithUsage[] }>(
    logging ? '/nutrition' : null,
  );
  const [editing, setEditing] = useState(false);
  const [menuCard, setMenuCard] = useState<WidgetCard | null>(null);
  const [removing, setRemoving] = useState(false);
  const [pendingOrder, setPendingOrder] = useState<string[] | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const cards = useMemo(
    () =>
      pendingOrder
        ? arrangeWidgets(data?.cards ?? [], pendingOrder)
        : (data?.cards ?? []),
    [data?.cards, pendingOrder],
  );

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

  if (isLoading) return <Spinner label="Opening Home…" />;
  if (error) return <ErrorNote message={(error as Error).message} />;
  if (!data) return null;
  const canReadPosts =
    portal.data?.access.social &&
    portal.data.access.nutrition &&
    portal.data.access.foodPosts;

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="sr-only">Home</h1>
      {saveError && (
        <div className="mb-3" role="alert">
          <ErrorNote message={saveError} />
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
          {(card, state, expanded, select) => (
            <HomeWidget
              card={card}
              nutrition={
                card.key === 'nutrition' ? data.summaries.nutrition : undefined
              }
              state={state}
              expanded={expanded}
              onSelect={select}
              onMenu={() => {
                setSaveError(null);
                setMenuCard(card);
              }}
              onQuickAction={
                card.quickAction?.kind === 'log-food'
                  ? () => setLogging(mealContextNow().slot)
                  : undefined
              }
            />
          )}
        </WidgetCarousel>
      )}

      {canReadPosts && (
        <section className="mt-5" aria-label="Friends feed">
          <div className="mb-3 flex items-center justify-between text-xs text-ink-muted">
            <h2 className="font-medium">From your friends</h2>
            <Link href="/wall" className="hover:text-accent">
              Open Wall →
            </Link>
          </div>
          <PostsList />
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
              className="btn-ghost justify-start text-rose-400"
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
  );
}
