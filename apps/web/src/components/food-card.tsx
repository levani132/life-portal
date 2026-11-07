'use client';

import clsx from 'clsx';
import { Archive, Globe, Pencil, Share2, Star, Trash2 } from 'lucide-react';
import type { FoodWithUsage } from '@life-portal/shared-types';
import { macroShares, mgToG } from '@life-portal/shared-domain';
import { MACRO_COLORS, MACRO_TEXT } from '../lib/macro-colors';
import { FoodArt } from './food-thumb';

/**
 * One food in the Foods tab: a large picture, its calories per serving, a bar of where those
 * calories come from, and the three macros in grams. The whole card opens the editor; the star
 * and the action buttons sit above that and do their own thing.
 */
export function FoodCard({
  food,
  busy,
  onEdit,
  onFavourite,
  onDelete,
  onShare,
}: {
  food: FoodWithUsage;
  busy?: boolean;
  onEdit: () => void;
  onFavourite: () => void;
  onDelete: () => void;
  onShare?: () => void;
}) {
  const { energyKcal, proteinMg, carbMg, fatMg } = food.perServing;
  const shares = macroShares({ proteinMg, carbMg, fatMg });
  const serving = food.servingLabel
    ? `${food.servingLabel} · ${food.servingSize} ${food.unit}`
    : `${food.servingSize} ${food.unit}`;
  const source =
    food.source === 'openfoodfacts'
      ? 'Open Food Facts'
      : food.source === 'imported'
        ? 'From a friend'
        : undefined;

  return (
    <li
      className={clsx(
        'group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-surface-raised transition hover:-translate-y-0.5 hover:shadow-lg',
        food.archived && 'opacity-60',
      )}
    >
      <button
        type="button"
        onClick={onEdit}
        className="absolute inset-0 z-0 rounded-2xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        aria-label={`Edit ${food.name}`}
      />

      <div className="pointer-events-none relative aspect-[4/3] overflow-hidden bg-surface">
        <FoodArt
          name={food.name}
          imageUrl={food.image?.url}
          macros={food.perServing}
          className="transition duration-300 group-hover:scale-105"
        />
        {food.image && (
          <span className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/40 to-transparent" />
        )}
        <div className="absolute right-2 top-2 flex gap-1">
          {food.archived && (
            <Badge title="Archived — kept so your history keeps its name">
              <Archive size={11} />
            </Badge>
          )}
          {food.visibility === 'public' && (
            <Badge title="Public — other people can import it">
              <Globe size={11} />
            </Badge>
          )}
        </div>
        {food.useCount > 0 && (
          <span className="absolute bottom-2 left-2 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur">
            eaten {food.useCount}×
          </span>
        )}
      </div>

      <button
        type="button"
        onClick={onFavourite}
        disabled={busy}
        aria-pressed={food.favourite}
        aria-label={food.favourite ? 'Remove from favourites' : 'Add to favourites'}
        className={clsx(
          'absolute left-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full backdrop-blur transition active:scale-90',
          food.favourite
            ? 'bg-amber-400 text-white shadow'
            : 'bg-black/35 text-white hover:bg-black/50',
        )}
      >
        <Star size={15} fill={food.favourite ? 'currentColor' : 'none'} />
      </button>

      <div className="pointer-events-none relative flex flex-1 flex-col gap-2 p-3">
        <div className="min-w-0">
          <p className="line-clamp-2 text-sm font-semibold leading-snug text-ink">
            {food.name}
          </p>
          {(food.brand || source) && (
            <p className="truncate text-[11px] text-ink-faint">
              {[food.brand, source].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>

        <div>
          <p className={clsx('tabular text-xl font-bold leading-none', MACRO_TEXT.kcal)}>
            {energyKcal.toLocaleString()}
            <span className="ml-0.5 text-[11px] font-medium text-ink-faint">kcal</span>
          </p>
          <p className="mt-0.5 truncate text-[11px] text-ink-faint">per {serving}</p>
        </div>

        <div
          className="flex h-1.5 overflow-hidden rounded-full bg-border"
          role="img"
          aria-label={`Calories from protein ${pct(shares.protein)}, carbs ${pct(shares.carbs)}, fat ${pct(shares.fat)}`}
        >
          <span style={{ width: pct(shares.protein), background: MACRO_COLORS.protein }} />
          <span style={{ width: pct(shares.carbs), background: MACRO_COLORS.carbs }} />
          <span style={{ width: pct(shares.fat), background: MACRO_COLORS.fat }} />
        </div>

        <dl className="grid grid-cols-3 gap-1 text-center">
          <Macro label="Protein" grams={mgToG(proteinMg)} className={MACRO_TEXT.protein} />
          <Macro label="Carbs" grams={mgToG(carbMg)} className={MACRO_TEXT.carbs} />
          <Macro label="Fat" grams={mgToG(fatMg)} className={MACRO_TEXT.fat} />
        </dl>

        <div className="pointer-events-auto mt-auto flex items-center justify-end gap-0.5 border-t border-border pt-2">
          {onShare && !food.archived && (
            <IconButton label={`Share ${food.name}`} onClick={onShare}>
              <Share2 size={15} />
            </IconButton>
          )}
          <IconButton label={`Edit ${food.name}`} onClick={onEdit}>
            <Pencil size={15} />
          </IconButton>
          <IconButton
            label={`Delete ${food.name}`}
            title="A food you have eaten is archived, so your history keeps its numbers"
            onClick={onDelete}
            disabled={busy}
            danger
          >
            <Trash2 size={15} />
          </IconButton>
        </div>
      </div>
    </li>
  );
}

function Macro({
  label,
  grams,
  className,
}: {
  label: string;
  grams: number;
  className: string;
}) {
  return (
    <div className="min-w-0 rounded-lg bg-surface py-1">
      <dd className={clsx('tabular text-sm font-semibold leading-tight', className)}>
        {grams}
        <span className="ml-px text-[10px] font-normal text-ink-faint">g</span>
      </dd>
      <dt className="truncate text-[9px] text-ink-faint sm:text-[10px]">{label}</dt>
    </div>
  );
}

function Badge({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <span
      title={title}
      aria-label={title}
      className="flex h-6 w-6 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur"
    >
      {children}
    </span>
  );
}

function IconButton({
  label,
  title,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string;
  title?: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={title ?? label}
      className={clsx(
        'relative z-10 flex h-8 w-8 items-center justify-center rounded-lg text-ink-faint transition hover:bg-surface',
        danger ? 'hover:text-rose-400' : 'hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}

function pct(share: number) {
  return `${Math.round(share * 100)}%`;
}
