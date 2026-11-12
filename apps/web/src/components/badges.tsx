'use client';
import {
  CalendarCheck,
  CircleCheck,
  Dumbbell,
  Flame,
  Newspaper,
  Sparkles,
  Sprout,
  Target,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { mutate } from 'swr';
import {
  badgeDefinition,
  badgeText,
  MAX_EQUIPPED_BADGES,
  type BadgeDefinition,
  type BadgeId,
  type BadgeView,
  type MyBadges,
  type PersonBadges,
  type PublicBadge,
} from '@life-portal/shared-types';
import { formatDay } from '@life-portal/shared-domain';
import { api } from '../lib/api';
import { revalidate, useAction, useApi } from '../lib/hooks';
import { earnedThisSession, myBadgesKey } from '../lib/badges';
import { ErrorNote, Modal, Spinner } from './ui';

/**
 * Profile badges (spec 022). Deliberately understated (FR-018): small marks, a quiet tint per
 * tier, no medals, confetti or sound.
 */
const ICONS: Record<string, LucideIcon> = {
  sparkles: Sparkles,
  post: Newspaper,
  friend: UserPlus,
  friends: Users,
  seedling: Sprout,
  flame: Flame,
  target: Target,
  check: CircleCheck,
  dumbbell: Dumbbell,
  calendar: CalendarCheck,
};

/** Higher tiers step from a neutral tint to the accent; nothing louder. */
function tierTint(def: BadgeDefinition, tier: number | undefined): string {
  if (tier == null) return 'border-border bg-surface text-ink-faint';
  const rank = def.tiers.indexOf(tier);
  const top = def.tiers.length > 1 && rank === def.tiers.length - 1;
  if (top) return 'border-accent/50 bg-accent/15 text-ink';
  if (rank > 0) return 'border-accent/30 bg-accent/10 text-ink';
  return 'border-border bg-surface-raised text-ink';
}

export function badgeName(def: BadgeDefinition, tier: number | undefined): string {
  return badgeText(def.name, tier ?? def.tiers[0]);
}

export function BadgeMark({
  badgeId,
  tier,
  locked = false,
}: {
  badgeId: string;
  tier?: number;
  locked?: boolean;
}) {
  const def = badgeDefinition(badgeId);
  if (!def) return null;
  const Icon = ICONS[def.icon] ?? Sparkles;
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${tierTint(
        def,
        locked ? undefined : tier,
      )}`}
    >
      <Icon size={14} className={locked ? 'shrink-0' : 'shrink-0 text-accent'} aria-hidden />
      <span className="truncate">{badgeName(def, tier)}</span>
    </span>
  );
}

function unitLabel(def: BadgeDefinition, count: number): string {
  const unit = def.unit ?? 'days';
  return count === 1 ? unit.replace(/s$/, '') : unit;
}

/** The owner's badges, evaluated (SWR-deduped between the header and the Badges tab). */
export function useMyBadges(enabled = true) {
  return useApi<MyBadges>(enabled ? myBadgesKey() : null);
}

/** What other people see on a profile: equipped badges only (US3). */
export function usePersonBadges(userId: string | null) {
  return useApi<PersonBadges>(userId ? `/badges/people/${userId}` : null);
}

/** The owner's equipped list, as the public shape the header renders. */
export function equippedOf(mine: MyBadges): PublicBadge[] {
  return mine.equipped.flatMap((id) => {
    const badge = mine.badges.find((row) => row.badgeId === id);
    return badge?.tier != null && badge.earnedOn
      ? [{ badgeId: id, tier: badge.tier, earnedOn: badge.earnedOn }]
      : [];
  });
}

/** The header row. Renders nothing when nothing is equipped: no empty slots, no placeholder. */
export function EquippedBadges({
  badges,
  onSelect,
}: {
  badges: PublicBadge[];
  onSelect: (badge: PublicBadge) => void;
}) {
  if (!badges.length) return null;
  return (
    <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Badges">
      {badges.map((badge) => (
        <li key={badge.badgeId} className="min-w-0 max-w-full">
          <button
            type="button"
            className="max-w-full rounded-full"
            onClick={() => onSelect(badge)}
          >
            <BadgeMark badgeId={badge.badgeId} tier={badge.tier} />
          </button>
        </li>
      ))}
    </ul>
  );
}

function BadgeFacts({ badgeId, tier, earnedOn }: { badgeId: string; tier: number; earnedOn?: string }) {
  const def = badgeDefinition(badgeId);
  if (!def) return null;
  return (
    <div className="space-y-3">
      <BadgeMark badgeId={badgeId} tier={tier} />
      <p className="text-sm text-ink-muted">{badgeText(def.description, tier)}</p>
      {earnedOn && <p className="text-xs text-ink-faint">Earned {formatDay(earnedOn)}</p>}
    </div>
  );
}

/** Someone else's badge: what it is and when it was earned, nothing more (FR-019). */
export function BadgeDetail({ badge, onClose }: { badge: PublicBadge | null; onClose: () => void }) {
  const def = badge && badgeDefinition(badge.badgeId);
  return (
    <Modal open={!!badge} onClose={onClose} title={def ? badgeName(def, badge.tier) : 'Badge'}>
      {badge && <BadgeFacts {...badge} />}
    </Modal>
  );
}

/**
 * The owner's badge: details plus showing it on the profile, removing it, moving it, or, with
 * every slot taken, choosing which equipped badge it replaces (a fourth is never added silently).
 */
export function OwnBadgeSheet({
  badgeId,
  mine,
  onClose,
}: {
  badgeId: BadgeId | null;
  mine: MyBadges;
  onClose: () => void;
}) {
  const action = useAction();
  const badge = mine.badges.find((row) => row.badgeId === badgeId);
  const def = badgeId ? badgeDefinition(badgeId) : undefined;
  const equipped = mine.equipped;
  const index = badgeId ? equipped.indexOf(badgeId) : -1;
  const full = equipped.length >= MAX_EQUIPPED_BADGES;

  async function save(next: BadgeId[]) {
    const key = myBadgesKey();
    const ok = await action.run(
      async () => {
        await mutate(key, { ...mine, equipped: next }, { revalidate: false });
        await api.put('/badges/me/equipped', { badgeIds: next });
        await revalidate('/badges');
      },
      { revalidate: false },
    );
    if (!ok) await revalidate('/badges');
    else onClose();
  }
  const move = (by: number) => {
    const next = [...equipped];
    const [item] = next.splice(index, 1);
    next.splice(index + by, 0, item);
    void save(next);
  };

  return (
    <Modal
      open={!!badge && badge.tier != null}
      onClose={onClose}
      title={def && badge ? badgeName(def, badge.tier) : 'Badge'}
      error={action.error}
    >
      {badge?.tier != null && badgeId && (
        <div className="space-y-5">
          <BadgeFacts badgeId={badgeId} tier={badge.tier} earnedOn={badge.earnedOn} />
          {index >= 0 ? (
            <div className="flex flex-wrap gap-2">
              {index > 0 && (
                <button type="button" className="btn-ghost" disabled={action.pending} onClick={() => move(-1)}>
                  Move left
                </button>
              )}
              {index < equipped.length - 1 && (
                <button type="button" className="btn-ghost" disabled={action.pending} onClick={() => move(1)}>
                  Move right
                </button>
              )}
              <button
                type="button"
                className="btn-ghost"
                disabled={action.pending}
                onClick={() => void save(equipped.filter((id) => id !== badgeId))}
              >
                Remove from profile
              </button>
            </div>
          ) : !full ? (
            <button
              type="button"
              className="btn-primary"
              disabled={action.pending}
              onClick={() => void save([...equipped, badgeId])}
            >
              Show on profile
            </button>
          ) : (
            <div>
              <p className="mb-2 text-sm text-ink-muted">
                Your profile shows {MAX_EQUIPPED_BADGES} badges. Replace one:
              </p>
              <div className="flex flex-wrap gap-2">
                {equipped.map((id) => {
                  const row = mine.badges.find((other) => other.badgeId === id);
                  return (
                    <button
                      type="button"
                      key={id}
                      className="max-w-full rounded-full"
                      disabled={action.pending}
                      onClick={() => void save(equipped.map((other) => (other === id ? badgeId : other)))}
                    >
                      <BadgeMark badgeId={id} tier={row?.tier} />
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <p className="text-xs text-ink-faint">
            Shown badges are visible to anyone who can see your profile. Your progress never is.
          </p>
        </div>
      )}
    </Modal>
  );
}

function BadgeRow({
  badge,
  onSelect,
  onProfile,
}: {
  badge: BadgeView;
  onSelect?: () => void;
  onProfile: boolean;
}) {
  const def = badgeDefinition(badge.badgeId);
  if (!def) return null;
  const locked = badge.tier == null;
  const isNew = !locked && (badge.isNew || earnedThisSession(badge.badgeId));
  const shownTier = badge.tier ?? badge.progress?.next ?? def.tiers[0];
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <BadgeMark badgeId={badge.badgeId} tier={shownTier} locked={locked} />
        {isNew ? (
          <span className="shrink-0 text-[11px] font-semibold text-accent">New</span>
        ) : onProfile ? (
          <span className="shrink-0 text-[11px] text-ink-faint">On profile</span>
        ) : null}
      </div>
      <p className="text-xs text-ink-muted">{badgeText(def.description, shownTier)}</p>
      <p className="text-xs text-ink-faint">
        {badge.earnedOn
          ? `Earned ${formatDay(badge.earnedOn)}`
          : badge.progress
            ? `${badge.progress.current} of ${badge.progress.next} ${unitLabel(def, badge.progress.next)}`
            : 'Not earned yet'}
        {badge.earnedOn && badge.progress && (
          <>
            {' · next: '}
            {badge.progress.current} of {badge.progress.next}
          </>
        )}
      </p>
    </>
  );
  const frame = `card flex w-full flex-col gap-2 p-3 text-left ${
    isNew ? 'ring-2 ring-accent/50' : ''
  } ${locked ? 'opacity-75' : ''}`;
  return (
    <li>
      {onSelect ? (
        <button type="button" className={`${frame} hover:border-accent/40`} onClick={onSelect}>
          {body}
        </button>
      ) : (
        <div className={frame}>{body}</div>
      )}
    </li>
  );
}

/** The owner's collection: earned first (tap to show on the profile), then locked with progress. */
export function BadgeCollection({
  open = null,
  onOpened,
}: {
  /** A badge to open once the collection has loaded (`/profile?badge=`). */
  open?: BadgeId | null;
  onOpened?: () => void;
} = {}) {
  const { data, error, isLoading } = useMyBadges();
  const [selected, setSelected] = useState<BadgeId | null>(null);
  useEffect(() => {
    if (!open || !data) return;
    // Only an earned, visible badge has a sheet; anything else just lands on the collection.
    if (data.badges.some((badge) => badge.badgeId === open && badge.tier != null))
      setSelected(open);
    onOpened?.();
  }, [open, data]);
  if (error) return <ErrorNote message="Badges couldn’t be loaded." />;
  if (isLoading || !data) return <Spinner label="Checking badges…" />;
  const earned = data.badges.filter((badge) => badge.tier != null);
  const locked = data.badges.filter((badge) => badge.tier == null);
  return (
    <div>
      <div className="mb-3 mt-6 flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold">Badges</h2>
        <span className="text-xs text-ink-faint">
          {earned.length} of {data.badges.length} earned · only you see progress
        </span>
      </div>
      {earned.length > 0 && (
        <>
          <p className="mb-3 text-xs text-ink-faint">
            Tap a badge to show it on your profile (up to {MAX_EQUIPPED_BADGES}
            ).
          </p>
          <ul className="grid gap-3 sm:grid-cols-2">
            {earned.map((badge) => (
              <BadgeRow
                key={badge.badgeId}
                badge={badge}
                onProfile={data.equipped.includes(badge.badgeId)}
                onSelect={() => setSelected(badge.badgeId)}
              />
            ))}
          </ul>
        </>
      )}
      {locked.length > 0 && (
        <>
          <h3 className="mb-2 mt-5 text-sm font-semibold text-ink-muted">Still to earn</h3>
          <ul className="grid gap-3 sm:grid-cols-2">
            {locked.map((badge) => (
              <BadgeRow key={badge.badgeId} badge={badge} onProfile={false} />
            ))}
          </ul>
        </>
      )}
      <OwnBadgeSheet badgeId={selected} mine={data} onClose={() => setSelected(null)} />
    </div>
  );
}
