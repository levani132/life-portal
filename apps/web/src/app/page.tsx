'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useState } from 'react';
import type {
  DashboardResponse,
  FoodWithUsage,
  MealSlot,
  WidgetCard,
} from '@life-portal/shared-types';
import { formatCents, formatDay } from '@life-portal/shared-domain';
import { AppShell } from '../components/app-shell';
import { LogFoodModal } from '../components/log-food-modal';
import {
  Chip,
  EmptyState,
  ErrorNote,
  EstimateMark,
  ProgressBar,
  Spinner,
  TONE_TEXT,
} from '../components/ui';
import { useApi } from '../lib/hooks';
import { mealContextNow } from '../lib/local-day';

/**
 * Accent → classes. Written out rather than interpolated, because Tailwind's scanner reads
 * source text and would strip a class built as `border-${accent}-500`.
 */
const ACCENT_RING: Record<string, string> = {
  rose: 'hover:border-rose-500/50',
  emerald: 'hover:border-emerald-500/50',
  amber: 'hover:border-amber-500/50',
  sky: 'hover:border-sky-500/50',
  violet: 'hover:border-violet-500/50',
  indigo: 'hover:border-indigo-500/50',
  teal: 'hover:border-teal-500/50',
  cyan: 'hover:border-cyan-500/50',
  fuchsia: 'hover:border-fuchsia-500/50',
  lime: 'hover:border-lime-500/50',
};

const ACCENT_DOT: Record<string, string> = {
  rose: 'bg-rose-500',
  emerald: 'bg-emerald-500',
  amber: 'bg-amber-500',
  sky: 'bg-sky-500',
  violet: 'bg-violet-500',
  indigo: 'bg-indigo-500',
  teal: 'bg-teal-500',
  cyan: 'bg-cyan-500',
  fuchsia: 'bg-fuchsia-500',
  lime: 'bg-lime-500',
};

export default function DashboardPage() {
  return (
    <AppShell>
      <Dashboard />
    </AppShell>
  );
}

function Dashboard() {
  const { data, error, isLoading } = useApi<DashboardResponse>('/dashboard');
  // The one quick action a card may carry (constitution principle I, amended 1.1.0). The foods
  // and the profile's day-start hour come from the food widget's own endpoint, so the dashboard
  // payload stays a summary.
  const [logging, setLogging] = useState<MealSlot | null>(null);
  const { data: food } = useApi<{ foods: FoodWithUsage[] }>(logging ? '/nutrition' : null);

  if (isLoading) return <Spinner label="Working out where you stand…" />;
  if (error) return <ErrorNote message={(error as Error).message} />;
  if (!data) return null;

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Where you stand</h1>
          <p className="mt-1 text-sm text-ink-muted">{formatDay(data.today)}</p>
        </div>
        <div className="text-right">
          <p className="text-xs uppercase tracking-wide text-ink-faint">Net position</p>
          <p
            className={clsx(
              'tabular text-2xl font-semibold',
              data.netPositionCents >= 0 ? 'text-emerald-400' : 'text-rose-400',
            )}
          >
            {formatCents(data.netPositionCents, data.displayCurrency)}
          </p>
          <p className="text-xs text-ink-faint">
            cash + items + shares − debts
            <EstimateMark basis="Items at their realistic price; shares at market value where a quote exists, at cost otherwise." />
          </p>
        </div>
      </div>

      {data.attention.length > 0 && (
        <ul className="mb-6 space-y-2">
          {data.attention.map((item, index) => (
            <li key={`${item.tone}-${index}`}>
              <Link
                href={item.href ?? '/'}
                className={clsx(
                  'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition hover:brightness-125',
                  item.tone === 'bad'
                    ? 'border-rose-500/40 bg-rose-500/10 text-rose-200'
                    : item.tone === 'warn'
                      ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
                      : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
                )}
              >
                {item.message}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {data.cards.length === 0 ? (
        <EmptyState message="No widgets yet. Run `npm run seed` to set up your boards and loan." />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.cards.map((card) => (
            <SummaryCard
              key={card.id}
              card={card}
              onQuickAction={
                card.quickAction?.kind === 'log-food'
                  ? () => setLogging(mealContextNow().slot)
                  : undefined
              }
            />
          ))}
        </div>
      )}

      {logging && (
        <LogFoodModal
          open
          onClose={() => setLogging(null)}
          foods={food?.foods ?? []}
          day={mealContextNow().day}
          slot={logging}
        />
      )}
    </>
  );
}

/**
 * The dashboard card: at most three numbers and a link, nothing interactive
 * (constitution principle I). Everything else lives on the detail page.
 */
function SummaryCard({
  card,
  onQuickAction,
}: {
  card: WidgetCard;
  onQuickAction?: () => void;
}) {
  return (
    <Link
      href={card.href}
      className={clsx(
        'card group flex flex-col gap-4 p-5 transition',
        ACCENT_RING[card.accent] ?? 'hover:border-ink-faint',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={clsx('h-2 w-2 rounded-full', ACCENT_DOT[card.accent] ?? 'bg-ink-faint')} />
          <div>
            <h2 className="text-sm font-semibold">{card.title}</h2>
            {card.subtitle && <p className="text-xs text-ink-faint">{card.subtitle}</p>}
          </div>
        </div>
        {card.quickAction && onQuickAction ? (
          <button
            type="button"
            aria-label={card.quickAction.label}
            title={card.quickAction.label}
            onClick={(event) => {
              // The card is a link; this one control is not, so navigation has to be stopped.
              event.preventDefault();
              event.stopPropagation();
              onQuickAction();
            }}
            className="-m-1 flex h-9 w-9 items-center justify-center rounded-lg border border-border text-xl leading-none text-ink-muted transition hover:border-lime-500/50 hover:text-ink active:scale-95"
          >
            +
          </button>
        ) : (
          <span className="text-ink-faint opacity-0 transition group-hover:opacity-100">→</span>
        )}
      </div>

      <dl className="grid grid-cols-3 gap-2">
        {card.stats.map((stat) => (
          <div key={stat.label}>
            <dd className={clsx('tabular text-base font-semibold', TONE_TEXT[stat.tone ?? 'neutral'])}>
              {stat.value}
              {stat.estimated && <EstimateMark />}
            </dd>
            <dt className="mt-0.5 text-[11px] leading-tight text-ink-faint">{stat.label}</dt>
          </div>
        ))}
      </dl>

      {card.progress != null && <ProgressBar ratio={card.progress} />}

      {card.alert && (
        <div className="mt-auto">
          <Chip tone={card.tone}>{card.alert}</Chip>
        </div>
      )}
    </Link>
  );
}
