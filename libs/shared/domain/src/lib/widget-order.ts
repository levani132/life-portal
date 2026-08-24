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
