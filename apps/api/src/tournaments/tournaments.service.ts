import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, type Model } from 'mongoose';
import {
  RANK_DIVISIONS,
  RANK_TIERS,
  TOURNAMENT_CONSENT_VERSION,
  TOURNAMENT_RETENTION_MONTHS,
  type JoinTournamentRequest,
  type SeasonView,
  type TournamentCategory,
  type TournamentEntry,
  type TournamentEntryStatus,
  type TournamentGroupView,
  type TournamentScoreView,
  type TournamentStanding,
  type TournamentOverview,
} from '@life-portal/shared-types';
import {
  addDays,
  enrollableSeason,
  groupRangeLabel,
  matchEntrants,
  placeStandings,
  scoringWindows,
  season as seasonOf,
  seasonDayAt,
  seasonPhase,
  tournamentExclusion,
  tournamentScore,
  type FrozenStandard,
  type Season,
  type TournamentEntrant,
} from '@life-portal/shared-domain';
import { AccessService } from '../access/access.module';
import { CONFIG, type AppConfig } from '../config/configuration';
import { NotificationsService } from '../notifications/notifications.service';
import { SocialGraphService } from '../social-graph/social-graph.module';
import { SocialService } from '../social/social.module';
import { TrainingProfileService } from '../training/profile.service';
import { TrainingRankService } from '../training/rank.service';
import {
  TournamentEntryRecord,
  TournamentGroupRecord,
  TournamentLockRecord,
  TournamentReminderRecord,
  type FrozenResult,
} from './tournaments.schemas';

type EntryRow = TournamentEntryRecord & { _id: unknown; createdAt?: Date };
type GroupRow = TournamentGroupRecord & { _id: unknown };

/** A claim on forming groups older than this without `formedAt` is taken over. */
const STALE_CLAIM_MS = 2 * 60 * 1000;

export function seasonView(target: Season, now: Date): SeasonView {
  return {
    id: target.id,
    firstDay: target.firstDay,
    lastDay: target.lastDay,
    enrolOpensAt: target.enrolOpensAt.toISOString(),
    locksAt: target.locksAt.toISOString(),
    endsAt: target.endsAt.toISOString(),
    finalizesAt: target.finalizesAt.toISOString(),
    phase: seasonPhase(target, now),
  };
}

/** Rows of a season are kept until 12 months after its results are final, then Mongo deletes them. */
export function expiryFor(target: Season): Date {
  const at = new Date(target.finalizesAt.getTime());
  // The 4th of a month: adding months never needs clamping.
  at.setUTCMonth(at.getUTCMonth() + TOURNAMENT_RETENTION_MONTHS);
  return at;
}

/**
 * Monthly strength tournaments (#12), behind `tournaments`. Enrolment with explicit category
 * consent, groups formed once at the lock from a snapshot of each entrant's rank and baseline,
 * live standings during the season, results frozen once grace ends, withdrawal, developer voiding
 * and three reminders. Scoring is the owner's formula (`tournamentScore` in the domain lib).
 */
@Injectable()
export class TournamentsService implements OnModuleInit {
  private readonly logger = new Logger(TournamentsService.name);

  constructor(
    @InjectModel(TournamentEntryRecord.name) private readonly entries: Model<TournamentEntryRecord>,
    @InjectModel(TournamentGroupRecord.name) private readonly groups: Model<TournamentGroupRecord>,
    @InjectModel(TournamentLockRecord.name) private readonly locks: Model<TournamentLockRecord>,
    @InjectModel(TournamentReminderRecord.name) private readonly reminders: Model<TournamentReminderRecord>,
    private readonly ranks: TrainingRankService,
    private readonly profiles: TrainingProfileService,
    private readonly social: SocialService,
    private readonly graph: SocialGraphService,
    private readonly access: AccessService,
    private readonly notifications: NotificationsService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  /** The current instant. A method so tests can move the clock. */
  now(): Date {
    return new Date();
  }

  onModuleInit() {
    // No actor: these are the app's own reminders, so `remind()`, generic lock-screen text, and
    // only to members who entered. No per-set or rank-change notifications exist.
    for (const type of ['tournamentEnrollmentOpen', 'tournamentGroupAssigned', 'tournamentResultsReady'] as const) {
      this.notifications.register({
        type,
        requires: ['training', 'tournaments'],
        windowMs: 0,
        personal: true,
        collapseKey: (event) => event.targetId,
        url: () => '/training',
      });
    }
  }

  /** Everything tournaments need: the feature, ranks, training and social (group members see names). */
  private async gate(userId: string) {
    const { access } = await this.access.forUser(userId);
    if (!access.tournaments || !access.trainingRanks || !access.training || !access.social) {
      throw new ForbiddenException('Tournaments are not available for your account.');
    }
  }

  // ── Reads ─────────────────────────────────────────────────────────────────

  async overview(userId: string): Promise<TournamentOverview> {
    await this.gate(userId);
    const now = this.now();
    const rows = await this.entries.find({ userId }).sort({ season: -1, createdAt: -1 }).lean<EntryRow[]>();
    const enrollable = enrollableSeason(now);
    return {
      ...(enrollable ? { enrollable: seasonView(enrollable, now) } : {}),
      entries: await Promise.all(rows.map((row) => this.entryView(userId, row, now))),
      consentVersion: TOURNAMENT_CONSENT_VERSION,
      retentionMonths: TOURNAMENT_RETENTION_MONTHS,
    };
  }

  private async entryView(userId: string, row: EntryRow, now: Date): Promise<TournamentEntry> {
    const target = seasonOf(row.season);
    let current = row;
    if (!row.outcome && !row.voidedAt && now >= target.locksAt) {
      // Groups are formed lazily as well as hourly, so nobody waits for the job.
      await this.ensureLocked(row.season, row.exerciseId, row.category as TournamentCategory);
      current = (await this.entries.findOne({ _id: row._id }).lean<EntryRow>()) ?? row;
    }
    const name = await this.ranks
      .rankFor(userId, row.exerciseId, seasonDayAt(now), row.category as TournamentCategory)
      .then((r) => r.name)
      .catch(() => 'Exercise');
    let result: TournamentEntry['result'];
    if (current.groupId && !current.voidedAt && now >= target.finalizesAt) {
      const group = await this.groups.findOne({ _id: current.groupId }).lean<GroupRow>();
      const finalGroup = group && (await this.ensureFinalized(group, now));
      if (finalGroup?.finalizedAt) {
        const placed = placeStandings(this.activeResults(finalGroup));
        const mine = placed.find((row) => row.userId === userId);
        if (mine) result = { of: placed.length, ...(mine.place ? { place: mine.place } : {}), ...(mine.score !== undefined ? { score: mine.score } : {}) };
      }
    }
    const status: TournamentEntryStatus = current.voidedAt
      ? 'voided'
      : ((current.outcome as TournamentEntryStatus | undefined) ?? (now >= target.locksAt ? 'forming' : 'entered'));
    return {
      id: String(row._id),
      exerciseId: row.exerciseId,
      exerciseName: name,
      season: seasonView(target, now),
      category: row.category as TournamentCategory,
      status,
      ...(current.lockedMilestone !== undefined
        ? { lockedRank: { tier: RANK_TIERS[Math.floor(current.lockedMilestone / 3)], division: RANK_DIVISIONS[current.lockedMilestone % 3] } }
        : {}),
      ...(current.groupId && !current.voidedAt ? { groupId: current.groupId } : {}),
      ...(current.voidReason ? { voidReason: current.voidReason } : {}),
      joinedAt: (row.createdAt ?? now).toISOString(),
      ...(result ? { result } : {}),
    };
  }

  /**
   * The viewer's own group. Anyone not in it (or withdrawn, or voided) gets a 404, never a hint
   * that the group exists. Each member shows public identity, place and tournament score only;
   * blocked pairs see "A member". Live until grace ends, then the frozen results. Only the viewer
   * gets their own breakdown.
   */
  async group(userId: string, groupId: string): Promise<TournamentGroupView> {
    await this.gate(userId);
    if (!isValidObjectId(groupId)) throw new NotFoundException('Group not found.');
    const [found, own] = await Promise.all([
      this.groups.findOne({ _id: groupId }).lean<GroupRow>(),
      this.entries.findOne({ userId, groupId, voidedAt: { $exists: false } }).lean<EntryRow>(),
    ]);
    if (!found || !own || !found.memberIds.includes(userId)) throw new NotFoundException('Group not found.');
    const now = this.now();
    const group = await this.ensureFinalized(found, now);
    const target = seasonOf(group.season);
    const [blocked, voided] = await Promise.all([
      this.graph.blockedUserIds(userId),
      this.entries.find({ groupId, voidedAt: { $exists: true } }).select('userId').lean<EntryRow[]>(),
    ]);
    const hidden = new Set(blocked);
    const gone = new Set(voided.map((row) => row.userId));
    const visible = group.memberIds.filter((id) => !gone.has(id));
    const results = group.finalizedAt ? this.activeResults(group) : await this.liveResults(group, target, now);
    const byUser = new Map(results.map((row) => [row.userId, row]));
    const identities = await this.social.authors(visible.filter((id) => !hidden.has(id)));
    const rows = visible.map((id) => {
      const identity = hidden.has(id) ? undefined : identities.get(id);
      const score = byUser.get(id)?.score;
      return { id, ...(identity ?? {}), self: id === userId, ...(score !== undefined ? { score } : {}) };
    });
    // Name order first, so equal places list alphabetically, never by volume or workouts.
    rows.sort((a, b) => ('displayName' in a ? (a.displayName as string) : '￿').localeCompare('displayName' in b ? (b.displayName as string) : '￿'));
    const standings: TournamentStanding[] = placeStandings(rows).map(({ id: _id, ...row }) => row);
    const mine = byUser.get(userId);
    const ranked = await this.ranks
      .rankFor(userId, group.exerciseId, seasonDayAt(now), group.category as TournamentCategory)
      .catch(() => undefined);
    const standardsVersion = own.lockedStandard?.version ?? own.lockedVersion;
    return {
      id: String(group._id),
      exerciseId: group.exerciseId,
      exerciseName: ranked?.name ?? 'Exercise',
      season: seasonView(target, now),
      category: group.category as TournamentCategory,
      rankRange: groupRangeLabel(group),
      // How scores read comes from the standard frozen at the lock, never today's standards.
      method: own.lockedStandard?.method ?? ranked?.view.benchmark?.method ?? 'e1rm',
      ...(standardsVersion ? { standardsVersion } : {}),
      standings,
      final: !!group.finalizedAt,
      ...(mine?.score !== undefined ? { own: ownScore(mine) } : {}),
    };
  }

  /** The frozen results of members still in the group (withdrawn or voided members drop out). */
  private activeResults(group: GroupRow): FrozenResult[] {
    const members = new Set(group.memberIds);
    return (group.results ?? []).filter((row) => members.has(row.userId));
  }

  /** Every current member's score, computed now. */
  private async liveResults(group: GroupRow, target: Season, now: Date): Promise<FrozenResult[]> {
    const rows = await this.entries
      .find({ groupId: String(group._id), voidedAt: { $exists: false }, userId: { $in: group.memberIds } })
      .lean<EntryRow[]>();
    return Promise.all(rows.map((row) => this.scoreOf(row, target, now)));
  }

  /**
   * One entrant's score: the best valid strength score of sets dated in the season and saved
   * before grace ended, under the benchmark version frozen at the lock, against the frozen
   * baseline. No valid set: no score. A replaced benchmark version withholds the bonus.
   */
  private async scoreOf(row: EntryRow, target: Season, now: Date): Promise<FrozenResult> {
    const windows = scoringWindows(target);
    const found = await this.ranks
      .strengthBest(
        row.userId,
        row.exerciseId,
        row.category as TournamentCategory,
        { from: windows.seasonFrom, to: windows.seasonTo },
        target.finalizesAt,
        row.lockedStandard ?? row.lockedVersion,
        seasonDayAt(now),
      )
      .catch(() => undefined);
    if (!found?.best) return { userId: row.userId };
    return { userId: row.userId, ...tournamentScore(found.best.score, row.lockedBaseline ?? 0, found.changed), day: found.best.basis.day };
  }

  /**
   * Freezes a group's results once grace has ended: written once (a conditional update, so two
   * readers never both send the reminder), then never recomputed. Sets saved later never count,
   * and editing or deleting history afterwards changes nothing.
   */
  private async ensureFinalized(group: GroupRow, now: Date): Promise<GroupRow> {
    const target = seasonOf(group.season);
    if (group.finalizedAt || now < target.finalizesAt) return group;
    const results = await this.liveResults(group, target, now);
    const written = await this.groups.updateOne(
      { _id: group._id, finalizedAt: { $exists: false } },
      { $set: { results, finalizedAt: now } },
    );
    if (written.matchedCount === 1) {
      for (const row of results) {
        void this.notifications.remind({ type: 'tournamentResultsReady', recipientId: row.userId, targetId: String(group._id) });
      }
    }
    return (await this.groups.findOne({ _id: group._id }).lean<GroupRow>()) ?? group;
  }

  // ── Writes ────────────────────────────────────────────────────────────────

  async join(userId: string, input: JoinTournamentRequest): Promise<TournamentEntry> {
    await this.gate(userId);
    const now = this.now();
    let target: Season;
    try {
      target = seasonOf(input.season);
    } catch {
      throw new BadRequestException('That is not a tournament month.');
    }
    if (seasonPhase(target, now) !== 'enrolling') {
      throw new BadRequestException('Enrolment for that month is not open.');
    }
    if (input.consentVersion !== TOURNAMENT_CONSENT_VERSION) {
      throw new BadRequestException('Please review what joining shares, then try again.');
    }
    const profile = await this.profiles.read(userId);
    if (profile.rankStandards !== input.category) {
      // The category must be chosen explicitly, and must match the standards the rank uses;
      // it is never derived from the private setting without the member choosing it here.
      throw new BadRequestException(
        profile.rankStandards
          ? 'Your rank uses the other standards. Choose that category, or change your standards first.'
          : 'Choose the standards for your rank first.',
      );
    }
    if (!(await this.social.authors([userId])).has(userId)) {
      throw new BadRequestException('Set up your profile first: group members see your name.');
    }
    const { view } = await this.ranks.rankFor(userId, input.exerciseId, seasonDayAt(now), input.category);
    if (view.reason === 'no_benchmark') throw new BadRequestException('This exercise has no rank standards, so it has no tournament.');
    if (view.benchmark && tournamentExclusion(view.benchmark) === 'machine') {
      throw new BadRequestException(
        'Machine and cable lifts have no tournament: machines differ, so loads can’t be compared fairly between people. Your rank on it still works.',
      );
    }
    if (view.status !== 'ranked') {
      throw new BadRequestException('You need a current rank on this exercise to join: log a valid set before enrolment closes.');
    }
    try {
      const created = await this.entries.create({
        userId,
        exerciseId: input.exerciseId,
        season: target.id,
        category: input.category,
        consentVersion: input.consentVersion,
        expireAt: expiryFor(target),
      });
      return this.entryView(userId, { ...(created.toObject() as EntryRow) }, now);
    } catch (error) {
      if ((error as { code?: number }).code === 11000) throw new ConflictException('You have already entered this tournament.');
      throw error;
    }
  }

  /** Takes effect at once, at any time: the entry is deleted and the member leaves their group. */
  async withdraw(userId: string, entryId: string): Promise<{ withdrawn: true }> {
    await this.gate(userId);
    if (!isValidObjectId(entryId)) throw new NotFoundException('Entry not found.');
    const entry = await this.entries.findOne({ _id: entryId, userId }).lean<EntryRow>();
    if (!entry) throw new NotFoundException('Entry not found.');
    if (entry.groupId) await this.leaveGroup(entry.groupId, userId);
    await this.entries.deleteOne({ _id: entryId, userId });
    return { withdrawn: true };
  }

  /** Developer only: the member keeps seeing their entry, with the reason; the group no longer shows them. */
  async voidEntry(userId: string, entryId: string, reason: string): Promise<{ voided: true }> {
    this.access.requireDeveloper(userId);
    if (!isValidObjectId(entryId)) throw new NotFoundException('Entry not found.');
    const entry = await this.entries.findOne({ _id: entryId }).lean<EntryRow>();
    if (!entry) throw new NotFoundException('Entry not found.');
    await this.entries.updateOne({ _id: entryId }, { $set: { voidedAt: this.now(), voidReason: reason.trim() } });
    if (entry.groupId) await this.leaveGroup(entry.groupId, entry.userId);
    return { voided: true };
  }

  /**
   * Removes everything tournaments hold about a member: their entries, their place in every group
   * and their frozen results. For account deletion (none exists yet; docs/modules/tournaments.md
   * says it must call this). Group-mates' rows are kept; places are derived, so theirs move up.
   */
  async eraseMember(userId: string): Promise<{ entries: number; groups: number }> {
    const groups = await this.groups
      .find({ $or: [{ memberIds: userId }, { 'results.userId': userId }] })
      .lean<GroupRow[]>();
    for (const group of groups) {
      await this.groups.updateOne(
        { _id: group._id },
        {
          $set: {
            memberIds: group.memberIds.filter((id) => id !== userId),
            ...(group.results ? { results: group.results.filter((row) => row.userId !== userId) } : {}),
          },
        },
      );
    }
    const { deletedCount } = await this.entries.deleteMany({ userId });
    return { entries: deletedCount ?? 0, groups: groups.length };
  }

  private async leaveGroup(groupId: string, userId: string) {
    const group = await this.groups.findOne({ _id: groupId }).lean<GroupRow>();
    if (group) {
      await this.groups.updateOne({ _id: groupId }, { $set: { memberIds: group.memberIds.filter((id) => id !== userId) } });
    }
  }

  // ── The lock ──────────────────────────────────────────────────────────────

  /**
   * Forms one exercise-and-category's groups for a season, once. Each entrant's rank is
   * recomputed as it stood when enrolment closed: the last day of the month before, and only
   * sets saved before the lock instant. Entrants without a current rank then get no group.
   */
  async ensureLocked(seasonId: string, exerciseId: string, category: TournamentCategory): Promise<void> {
    const target = seasonOf(seasonId);
    const now = this.now();
    if (now < target.locksAt) return;
    const key = { season: seasonId, exerciseId, category };
    if (!(await this.claim(key, target, now))) return;

    const rows = await this.entries.find({ ...key, voidedAt: { $exists: false } }).lean<EntryRow[]>();
    const lockDay = addDays(target.firstDay, -1);
    const entrants: TournamentEntrant[] = [];
    const notRanked: EntryRow[] = [];
    const notEligible: EntryRow[] = [];
    const locked = new Map<string, { milestone: number; score: number; version: string; baseline: number; standard: FrozenStandard }>();
    const windows = scoringWindows(target);
    for (const row of rows) {
      const result = await this.ranks
        .rankFor(row.userId, exerciseId, lockDay, category, target.locksAt)
        .catch(() => undefined);
      const current = result?.view.current;
      const version = result?.view.benchmark?.version;
      // The baseline: the best strength score (no work-capacity bonus) of the same 90 days, from
      // the same sets. A current rank implies one; without either there is no entry to score.
      const baseline =
        current && version
          ? await this.ranks
              .strengthBest(row.userId, exerciseId, category, { from: windows.baselineFrom, to: windows.baselineTo }, target.locksAt, version, lockDay)
              .catch(() => undefined)
          : undefined;
      if (baseline?.standard && tournamentExclusion(baseline.standard) === 'machine') {
        // Only an entry made before machine lifts were excluded can get here.
        notEligible.push(row);
        continue;
      }
      if (!current || !version || !baseline?.best || !baseline.standard) {
        notRanked.push(row);
        continue;
      }
      entrants.push({ userId: row.userId, milestone: current.milestone, score: current.score });
      locked.set(row.userId, { milestone: current.milestone, score: current.score, version, baseline: baseline.best.score, standard: baseline.standard });
    }
    const { groups, unmatched } = matchEntrants(entrants);
    // A retaken claim starts over, so a half-finished earlier attempt leaves nothing behind.
    await this.groups.deleteMany(key);
    const expireAt = expiryFor(target);
    const assigned: { userId: string; groupId: string }[] = [];
    for (const [index, group] of groups.entries()) {
      const created = await this.groups.create({
        ...key,
        index,
        minMilestone: group.minMilestone,
        maxMilestone: group.maxMilestone,
        memberIds: group.entrants.map((e) => e.userId),
        expireAt,
      });
      for (const entrant of group.entrants) assigned.push({ userId: entrant.userId, groupId: String(created._id) });
    }
    const snapshot = (userId: string) => {
      const rank = locked.get(userId);
      return rank
        ? {
            lockedMilestone: rank.milestone,
            lockedScore: rank.score,
            lockedVersion: rank.version,
            lockedBaseline: rank.baseline,
            lockedStandard: rank.standard,
          }
        : {};
    };
    for (const { userId, groupId } of assigned) {
      await this.entries.updateOne({ ...key, userId }, { $set: { outcome: 'grouped', groupId, ...snapshot(userId) } });
    }
    for (const entrant of unmatched) {
      await this.entries.updateOne({ ...key, userId: entrant.userId }, { $set: { outcome: 'no_tournament', ...snapshot(entrant.userId) } });
    }
    for (const row of notRanked) {
      await this.entries.updateOne({ ...key, userId: row.userId }, { $set: { outcome: 'not_ranked' } });
    }
    for (const row of notEligible) {
      await this.entries.updateOne({ ...key, userId: row.userId }, { $set: { outcome: 'not_eligible' } });
    }
    await this.locks.updateOne(key, { $set: { formedAt: now } });
    for (const { userId, groupId } of assigned) {
      void this.notifications.remind({ type: 'tournamentGroupAssigned', recipientId: userId, targetId: groupId });
    }
  }

  /** True when this caller may form the groups now. */
  private async claim(key: { season: string; exerciseId: string; category: string }, target: Season, now: Date) {
    try {
      await this.locks.create({ ...key, claimedAt: now, expireAt: expiryFor(target) });
      return true;
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
    }
    const existing = await this.locks.findOne(key).lean<TournamentLockRecord>();
    if (!existing || existing.formedAt || now.getTime() - existing.claimedAt.getTime() < STALE_CLAIM_MS) return false;
    const taken = await this.locks.updateOne({ ...key, claimedAt: existing.claimedAt, formedAt: { $exists: false } }, { $set: { claimedAt: now } });
    return taken.matchedCount === 1;
  }

  // ── Jobs ──────────────────────────────────────────────────────────────────

  /** Hourly: form the groups of every season whose lock has passed. */
  async lockDue(): Promise<number> {
    const now = this.now();
    const pending = await this.entries
      .find({ outcome: { $exists: false }, voidedAt: { $exists: false } })
      .select('season exerciseId category')
      .lean<EntryRow[]>();
    const keys = new Map<string, EntryRow>();
    for (const row of pending) {
      if (now >= seasonOf(row.season).locksAt) keys.set(`${row.season}|${row.exerciseId}|${row.category}`, row);
    }
    for (const row of keys.values()) {
      await this.ensureLocked(row.season, row.exerciseId, row.category as TournamentCategory).catch((error: unknown) =>
        this.logger.warn(`Forming groups failed: ${error instanceof Error ? error.message : 'unknown error'}`),
      );
    }
    return keys.size;
  }

  /** Hourly: freeze the results of every group whose grace period has ended. */
  async finalizeDue(): Promise<number> {
    const now = this.now();
    const open = await this.groups.find({ finalizedAt: { $exists: false } }).lean<GroupRow[]>();
    let done = 0;
    for (const group of open) {
      if (now < seasonOf(group.season).finalizesAt) continue;
      await this.ensureFinalized(group, now)
        .then(() => done++)
        .catch((error: unknown) => this.logger.warn(`Finalizing results failed: ${error instanceof Error ? error.message : 'unknown error'}`));
    }
    return done;
  }

  /**
   * Once per season, at the first hourly run after enrolment opens on the 20th: remind members who
   * have entered before (and still have entries within the retention period) that next month is
   * open. Nobody else is ever sent one. A unique row per season makes it once, across runs,
   * restarts and instances; a run missed at midnight is made up later while enrolment is open.
   */
  async remindEnrollmentOpen(): Promise<number> {
    const now = this.now();
    const open = enrollableSeason(now);
    if (!open) return 0;
    try {
      await this.reminders.create({ season: open.id, sentAt: now, expireAt: expiryFor(open) });
    } catch (error) {
      if ((error as { code?: number }).code === 11000) return 0;
      throw error;
    }
    const recipients = (await this.entries.distinct('userId', {})) as string[];
    for (const recipientId of recipients) {
      void this.notifications.remind({ type: 'tournamentEnrollmentOpen', recipientId, targetId: open.id });
    }
    return recipients.length;
  }

  get schedulesDisabled() {
    return this.config.disableSchedules;
  }
}

/** The viewer's own breakdown from a scored result. */
function ownScore(row: FrozenResult): TournamentScoreView {
  return {
    score: row.score as number,
    strengthScore: row.strengthScore as number,
    baseline: row.baseline ?? 0,
    improvementBp: row.improvementBp ?? 0,
    bonusBp: row.bonusBp ?? 0,
    ...(row.bonusWithheld === 'standards_changed' ? { bonusWithheld: 'standards_changed' as const } : {}),
    day: row.day ?? '',
  };
}
