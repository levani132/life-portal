/**
 * Dashboard arrangement.
 *
 * The user's chosen card order is stored as a plain list of card ids on their settings
 * (`widgetOrder`). It is deliberately *not* a per-card `position` field: cards are derived from
 * each widget's summary on every read (principle III) and a card can appear, disappear or be
 * renamed between two requests, so the arrangement has to be a list of preferences that
 * tolerates ids it has never seen and ids that no longer exist.
 *
 * Both ends use these functions — the API sorts the payload with `arrangeWidgets` and the
 * browser reorders optimistically with the same call while a drag is in flight, so there is one
 * definition of "what order are the cards in" rather than two that can drift.
 */

/** The shape `arrangeWidgets` needs: a stable id and the widget's own default rank. */
export interface ArrangeableWidget {
  /** Unique per card: `loans`, `board:epam`, … */
  id: string;
  /** The rank the widget ships with, used for anything the user has not arranged. */
  order: number;
}

/**
 * Sorts `cards` into the user's arrangement.
 *
 * Three rules, in this order:
 *
 * 1. A card the user has arranged sits where they put it.
 * 2. A card they have never seen — a board added yesterday, a widget added by a deploy — goes
 *    *after* every arranged card, ranked among its fellow newcomers by the widget's own
 *    `order`. Same as a newly installed app landing on the last home screen rather than
 *    shuffling the icons someone already positioned.
 * 3. An id in `preferred` that matches no card is ignored, so deleting a board does not leave
 *    a hole and does not need a migration.
 *
 * Pure, and it copies rather than sorting in place, because the caller's array is React state
 * on one side and a Mongoose-derived list on the other.
 */
export function arrangeWidgets<T extends ArrangeableWidget>(
  cards: readonly T[],
  preferred: readonly string[] | undefined,
): T[] {
  const rank = new Map<string, number>();
  (preferred ?? []).forEach((id, index) => {
    // First mention wins, so a duplicated id cannot make the sort inconsistent.
    if (!rank.has(id)) rank.set(id, index);
  });

  return [...cards].sort((a, b) => {
    const rankA = rank.get(a.id);
    const rankB = rank.get(b.id);
    if (rankA != null && rankB != null) return rankA - rankB;
    if (rankA != null) return -1;
    if (rankB != null) return 1;
    return a.order - b.order;
  });
}

/**
 * Moves the id at `from` to `to`, closing the gap behind it — the reorder a drag or an arrow
 * key performs. Out-of-range indices return the list unchanged rather than throwing, because
 * both callers compute them from live pointer positions.
 */
export function moveWidget(ids: readonly string[], from: number, to: number): string[] {
  if (from === to) return [...ids];
  if (from < 0 || from >= ids.length) return [...ids];

  const next = [...ids];
  const [moved] = next.splice(from, 1);
  next.splice(Math.min(Math.max(to, 0), next.length), 0, moved);
  return next;
}

/** The widths a card on Home may take, as fractions of the strip. Same list as `WIDGET_SIZES`. */
const SIZES = ['half', 'wide', 'full'] as const;
type Size = (typeof SIZES)[number];

/** The most sizes kept: as many as the arrangement itself (`WidgetOrderDto`). */
export const WIDGET_SIZES_MAX = 64;

/**
 * Gives each card the width the person chose for it; a card with no choice, or with a stored
 * value this version does not know, is `wide`. Like the order, the stored map is a list of
 * preferences: an id with no card is ignored.
 */
export function sizeWidgets<T extends { id: string }>(
  cards: readonly T[],
  sizes: Readonly<Record<string, unknown>> | undefined,
): (T & { size: Size })[] {
  return cards.map((card) => {
    const chosen = sizes?.[card.id];
    return { ...card, size: SIZES.includes(chosen as Size) ? (chosen as Size) : 'wide' };
  });
}

/**
 * The stored map after one card's size is chosen. `wide` is the default, so choosing it removes
 * the entry; the map never grows past `WIDGET_SIZES_MAX` (the oldest entries go first).
 */
export function withWidgetSize(
  sizes: Readonly<Record<string, unknown>> | undefined,
  id: string,
  size: Size,
): Record<string, Size> {
  const kept = Object.entries(sizes ?? {}).filter(
    (entry): entry is [string, Size] => entry[0] !== id && SIZES.includes(entry[1] as Size) && entry[1] !== 'wide',
  );
  if (size !== 'wide') kept.push([id, size]);
  return Object.fromEntries(kept.slice(-WIDGET_SIZES_MAX));
}
