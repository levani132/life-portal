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
import {
  badgeDefinition,
  badgeText,
  type BadgeDefinition,
  type BadgeView,
  type MyBadges,
} from '@life-portal/shared-types';
import { formatDay } from '@life-portal/shared-domain';
import { useApi } from '../lib/hooks';
import { earnedThisSession, myBadgesKey } from '../lib/badges';
import { ErrorNote, Spinner } from './ui';

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

function BadgeRow({ badge }: { badge: BadgeView }) {
  const def = badgeDefinition(badge.badgeId);
  if (!def) return null;
  const locked = badge.tier == null;
  const isNew = !locked && (badge.isNew || earnedThisSession(badge.badgeId));
  const shownTier = badge.tier ?? badge.progress?.next ?? def.tiers[0];
  return (
    <li
      className={`card flex flex-col gap-2 p-3 ${
        isNew ? 'ring-2 ring-accent/50' : ''
      } ${locked ? 'opacity-75' : ''}`}
    >
      <div className="flex items-center justify-between gap-2">
        <BadgeMark badgeId={badge.badgeId} tier={shownTier} locked={locked} />
        {isNew && <span className="shrink-0 text-[11px] font-semibold text-accent">New</span>}
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
    </li>
  );
}

/** The owner's collection: earned first, then locked with private progress. */
export function BadgeCollection() {
  const { data, error, isLoading } = useApi<MyBadges>(myBadgesKey());
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
        <ul className="grid gap-3 sm:grid-cols-2">
          {earned.map((badge) => (
            <BadgeRow key={badge.badgeId} badge={badge} />
          ))}
        </ul>
      )}
      {locked.length > 0 && (
        <>
          <h3 className="mb-2 mt-5 text-sm font-semibold text-ink-muted">Still to earn</h3>
          <ul className="grid gap-3 sm:grid-cols-2">
            {locked.map((badge) => (
              <BadgeRow key={badge.badgeId} badge={badge} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
