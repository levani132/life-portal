'use client';

import { useState } from 'react';
import type {
  ExerciseRankView,
  PortalState,
  SeasonView,
  TournamentCategory,
  TournamentEntry,
  TournamentGroupView,
  TournamentOverview,
  TournamentScoreView,
} from '@life-portal/shared-types';
import { formatDay } from '@life-portal/shared-domain';
import { api } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import { ErrorNote, Spinner } from '../ui';
import { formatRankScore } from './strength-rank';

/**
 * Monthly strength tournaments (#12) for one exercise, inside its statistics view. Behind
 * `tournaments`. Joining is an explicit opt-in: the member picks the category themselves and sees
 * exactly what joining shares, for how long, and that there are no prizes, before agreeing.
 * A group ranks by tournament score (the owner's formula); only the viewer sees how their own
 * score was worked out.
 */

export const TOURNAMENTS_KEY = '/tournaments';

/** "December 2026". */
export function monthName(season: Pick<SeasonView, 'firstDay'>) {
  return new Date(`${season.firstDay}T00:00:00Z`).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** An instant in the member's own time zone, e.g. "1 Dec 2026, 04:00". */
export function localTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** 1st, 2nd, 3rd, 4th, 11th, 21st… */
export function ordinal(n: number) {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${suffix}`;
}

/** Basis points as a percentage, e.g. 333 → "3.33%". */
export const percent = (bp: number) => `${(bp / 100).toFixed(2)}%`;

const CATEGORY_LABEL: Record<TournamentCategory, string> = { men: 'Men’s', women: 'Women’s' };

export function entryStatusText(entry: TournamentEntry): string {
  switch (entry.status) {
    case 'entered':
      return `Entered. Groups are set when enrolment closes, ${localTime(entry.season.locksAt)}.`;
    case 'forming':
      return 'Enrolment has closed; your group is being set.';
    case 'grouped':
      if (!entry.result) return 'You’re in a group.';
      return entry.result.place
        ? `Final result: ${ordinal(entry.result.place)} of ${entry.result.of}.`
        : `Final result: no valid set this month, so no place (${entry.result.of} in the group).`;
    case 'no_tournament':
      return 'Fewer than 3 people entered this exercise in your category, so there is no competition this month. Nobody is invented to fill a group.';
    case 'not_ranked':
      return 'You had no current rank on this exercise when enrolment closed, so you weren’t placed in a group.';
    case 'not_eligible':
      return 'Machine and cable lifts have no tournament, so you weren’t placed in a group. Machines differ, so loads can’t be compared fairly between people.';
    case 'voided':
      return `Removed from this tournament${entry.voidReason ? `: ${entry.voidReason}` : '.'}`;
  }
}

export function TournamentPanel({ exerciseId, today }: { exerciseId: string; today: string }) {
  const portal = useApi<PortalState>('/portal');
  const access = portal.data?.access;
  const enabled = !!(access?.tournaments && access.trainingRanks && access.social);
  const overview = useApi<TournamentOverview>(enabled ? TOURNAMENTS_KEY : null);
  const rank = useApi<ExerciseRankView>(enabled ? `/training/exercises/${exerciseId}/rank?today=${today}` : null);
  const [joining, setJoining] = useState(false);
  if (!enabled) return null;
  if (overview.error) return <ErrorNote message={(overview.error as Error).message} />;
  if (!overview.data || !rank.data) return null;
  // No standards for this exercise: no tournament either, and nothing to say here.
  if (rank.data.reason === 'no_benchmark') return null;
  const entries = overview.data.entries.filter((entry) => entry.exerciseId === exerciseId);
  if (rank.data.benchmark?.machine && !entries.length) {
    // Machines are private to whoever adds them, so nothing tells two people's machines apart.
    return (
      <section aria-label="Tournaments" className="rounded-xl border border-border p-3 text-sm">
        <h4 className="label">Monthly tournament</h4>
        <p className="mt-1 text-ink-muted">
          Machine and cable lifts have no tournament: machines differ, so loads can’t be compared fairly between people. Your rank on this
          lift still works. Free-weight lifts have tournaments.
        </p>
      </section>
    );
  }
  const open = overview.data.enrollable;
  const enteredOpen = open && entries.some((entry) => entry.season.id === open.id);
  return (
    <section aria-label="Tournaments" className="rounded-xl border border-border p-3 text-sm">
      <h4 className="label">Monthly tournament</h4>
      {entries.map((entry) => (
        <EntryRow key={entry.id} entry={entry} onChange={() => void overview.mutate()} />
      ))}
      {open && !enteredOpen && (
        rank.data.status === 'ranked' ? (
          joining ? (
            <JoinConsent
              season={open}
              exerciseId={exerciseId}
              standards={rank.data.benchmark?.standards}
              consentVersion={overview.data.consentVersion}
              retentionMonths={overview.data.retentionMonths}
              onDone={() => {
                setJoining(false);
                void overview.mutate();
              }}
              onCancel={() => setJoining(false)}
            />
          ) : (
            <div className="mt-1">
              <p className="text-ink-muted">
                {monthName(open)}: compete on this lift against people at a similar rank. Enrolment closes {localTime(open.locksAt)}.
              </p>
              <button type="button" className="btn-primary mt-2" onClick={() => setJoining(true)}>
                Join {monthName(open)}
              </button>
            </div>
          )
        ) : (
          <p className="mt-1 text-ink-muted">
            {monthName(open)}’s tournament needs a current rank on this lift. Log a valid set before {localTime(open.locksAt)} to join.
          </p>
        )
      )}
      {!open && !entries.length && <p className="mt-1 text-ink-muted">Next month’s tournament opens to join on the 20th.</p>}
    </section>
  );
}

function EntryRow({ entry, onChange }: { entry: TournamentEntry; onChange: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [showGroup, setShowGroup] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  async function withdraw() {
    setProblem(null);
    try {
      await api.delete(`${TOURNAMENTS_KEY}/entries/${entry.id}`);
      onChange();
    } catch (caught) {
      setProblem(caught instanceof Error ? caught.message : 'Could not withdraw.');
    }
  }
  return (
    <div className="mt-2 border-b border-border pb-2 last:border-0">
      <p className="font-medium">
        {monthName(entry.season)} · {CATEGORY_LABEL[entry.category]} category
      </p>
      <p className="text-ink-muted">{entryStatusText(entry)}</p>
      <div className="mt-1 flex flex-wrap gap-3 text-xs">
        {entry.groupId && (
          <button type="button" className="text-accent underline" onClick={() => setShowGroup((value) => !value)}>
            {showGroup ? 'Hide group' : 'See group'}
          </button>
        )}
        {entry.status !== 'voided' &&
          (confirming ? (
            <span>
              Withdraw now? You leave the group at once.{' '}
              <button type="button" className="text-accent underline" onClick={() => void withdraw()}>
                Withdraw
              </button>{' '}
              <button type="button" className="underline" onClick={() => setConfirming(false)}>
                Keep
              </button>
            </span>
          ) : (
            <button type="button" className="underline" onClick={() => setConfirming(true)}>
              Withdraw
            </button>
          ))}
      </div>
      {problem && <ErrorNote message={problem} />}
      {showGroup && entry.groupId && <GroupList groupId={entry.groupId} />}
    </div>
  );
}

export function GroupList({ groupId }: { groupId: string }) {
  const { data, error } = useApi<TournamentGroupView>(`${TOURNAMENTS_KEY}/groups/${groupId}`);
  if (error) return <ErrorNote message={(error as Error).message} />;
  if (!data) return <Spinner />;
  const format = (score: number) => formatRankScore(score, data);
  return (
    <div className="mt-2 rounded-lg bg-surface-raised p-2">
      <p className="text-xs text-ink-muted">
        {data.rankRange} · {data.standings.length} {data.standings.length === 1 ? 'member' : 'members'} ·{' '}
        {data.standardsVersion ? `standards ${data.standardsVersion}, fixed for the month · ` : ''}
        {data.final
          ? 'final results'
          : `live until ${localTime(data.season.finalizesAt)}; workouts dated ${data.season.firstDay} to ${data.season.lastDay} (UTC month) and saved by then count`}
      </p>
      <ol className="mt-2 space-y-1" aria-label={data.final ? 'Final standings' : 'Live standings'}>
        {data.standings.map((row, i) => (
          <li key={row.userId ?? `hidden-${i}`} className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-right tabular-nums text-ink-muted">
              {row.place ? ordinal(row.place) : <span aria-label="No place">–</span>}
            </span>
            {row.avatarUrl ? (
              <img src={row.avatarUrl} alt="" className="h-6 w-6 shrink-0 rounded-full object-cover" />
            ) : (
              <span aria-hidden className="h-6 w-6 shrink-0 rounded-full bg-border" />
            )}
            <span className="truncate">{row.displayName ?? 'A member'}</span>
            {row.self && <span className="text-xs text-ink-muted">(you)</span>}
            <span className="ml-auto shrink-0 tabular-nums text-xs">{row.score !== undefined ? format(row.score) : 'no valid set yet'}</span>
          </li>
        ))}
      </ol>
      {data.own && <OwnScore own={data.own} format={format} />}
      <p className="mt-2 text-xs text-ink-faint">
        Ranked by tournament score: your best valid set dated this month, on strength alone (extra sets, workouts and volume add
        nothing), raised by up to 5% for improving on your baseline. Exact ties share a place. Logs are self-reported.
      </p>
    </div>
  );
}

/** How the viewer's own score was worked out. Only ever the viewer's. */
export function OwnScore({ own, format }: { own: TournamentScoreView; format: (score: number) => string }) {
  return (
    <div className="mt-2 border-t border-border pt-2 text-xs" aria-label="How your score is worked out">
      <p className="font-medium text-ink">Your score: {format(own.score)}</p>
      <ul className="mt-1 space-y-0.5 text-ink-muted">
        <li>
          Best this month: {format(own.strengthScore)}{own.day ? `, ${formatDay(own.day)}` : ''}
        </li>
        <li>Baseline, frozen when enrolment closed (your best in the 90 days before): {format(own.baseline)}</li>
        <li>
          Improvement {percent(own.improvementBp)} → bonus +{percent(own.bonusBp)}
          {own.bonusWithheld ? '' : ' (a third of the improvement, at most +5%, reached at +15%)'}
        </li>
        {own.bonusWithheld === 'standards_changed' && (
          <li>The rank standards changed after enrolment closed, so the improvement can’t be compared fairly and no bonus applies.</li>
        )}
        <li>
          {format(own.strengthScore)} × {(1 + own.bonusBp / 10_000).toFixed(4)} = {format(own.score)}
        </li>
      </ul>
    </div>
  );
}

/** Everything a member must see before joining, then an explicit choice and agreement. */
export function JoinConsent({
  season,
  exerciseId,
  standards,
  consentVersion,
  retentionMonths,
  onDone,
  onCancel,
}: {
  season: SeasonView;
  exerciseId: string;
  standards?: TournamentCategory;
  consentVersion: number;
  retentionMonths: number;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [category, setCategory] = useState<TournamentCategory | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  async function join() {
    if (!category) return;
    setBusy(true);
    setProblem(null);
    try {
      await api.post(`${TOURNAMENTS_KEY}/entries`, { exerciseId, season: season.id, category, consentVersion });
      onDone();
    } catch (caught) {
      setProblem(caught instanceof Error ? caught.message : 'Could not join.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-2 space-y-3" role="group" aria-label={`Join ${monthName(season)}`}>
      <fieldset>
        <legend className="font-medium">Category</legend>
        <p className="text-xs text-ink-muted">
          Men’s and women’s tournaments are separate, like the rank standards. Group members will see which category you
          entered.{standards ? ` Your rank uses the ${CATEGORY_LABEL[standards].toLowerCase()} standards, so that is the category you can enter.` : ''}
        </p>
        <div className="mt-1 flex gap-4">
          {(['men', 'women'] as const).map((value) => (
            <label key={value} className="flex items-center gap-2">
              <input type="radio" name="tournament-category" value={value} checked={category === value} onChange={() => setCategory(value)} />
              {CATEGORY_LABEL[value]}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="text-xs text-ink-muted">
        <p className="font-medium text-ink">What joining shares</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          <li>Only with the people in your group (3 to 100, at a similar rank on this lift): your name, username and photo, the category, the group’s rank range, and later your place and tournament score.</li>
          <li>Never your weights, reps, body weight, workouts, dates or anything else you log. Nothing is public or shown on your profile.</li>
          <li>Joining allows this use only, for this tournament. Your workout history is not used for anything else.</li>
          <li>People who blocked you, or whom you blocked, see each other only as “A member”.</li>
        </ul>
        <p className="mt-2 font-medium text-ink">How it runs</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          <li>
            Enrolment closes {localTime(season.locksAt)}; your rank then fixes your group, and later rank changes don’t move you. The month runs
            {' '}{season.firstDay} to {season.lastDay} in UTC; workouts saved until {localTime(season.finalizesAt)} count, later ones never do.
          </li>
          <li>Results are kept for {retentionMonths} months, then deleted. You can withdraw at any time; you leave the group at once.</li>
          <li>Logs are self-reported. Impossible entries are left out, and an entry can be removed with a reason.</li>
          <li>
            Your score is your best valid set dated this month, on strength alone, raised by up to 5% for improving on your best of the 90
            days before enrolment closes. More sets or workouts add nothing. Exact ties share a place.
          </li>
          <li>There are no prizes.</li>
        </ul>
      </div>
      <label className="flex items-start gap-2">
        <input type="checkbox" className="mt-1" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} />
        <span>I agree to share this with my group for {monthName(season)}.</span>
      </label>
      {problem && <ErrorNote message={problem} />}
      <div className="flex gap-2">
        <button type="button" className="btn-primary" disabled={!category || !agreed || busy} onClick={() => void join()}>
          Join
        </button>
        <button type="button" className="btn-ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
