import { Controller, Get, Header, Inject, Injectable, Module, Query } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { IsIn, IsOptional, Matches } from 'class-validator';
import { Type } from 'class-transformer';
import type { Connection } from 'mongoose';
import { USAGE_RANGES, USAGE_RETENTION_WINDOW_DAYS, type UsageKind, type UsageRange, type UsageReport } from '@life-portal/shared-types';
import { addDays, usageReport, type UsageEvent } from '@life-portal/shared-domain';
import { AccessService } from '../access/access.module';
import { CurrentUser } from '../auth/current-user.decorator';

/** The zone a timestamp's day is read in. The app's people are in Georgia; a day string is used as it is. */
export const USAGE_TIMEZONE = 'Asia/Tbilisi';

export interface UsageSource {
  collection: string;
  kind: UsageKind;
  /** The field holding the person. */
  user: string;
  /** A stored calendar day, or (`at`) a timestamp turned into a day in `USAGE_TIMEZONE`. */
  day?: string;
  at?: string;
  match?: Record<string, unknown>;
}

/**
 * Where activity is read from: one line per kind of record. Only who and which day is read,
 * never what the record says.
 */
export const USAGE_SOURCES: UsageSource[] = [
  { collection: 'meal_entries', kind: 'food', user: 'userId', day: 'day' },
  { collection: 'workout_sessions', kind: 'training', user: 'userId', day: 'day' },
  { collection: 'weigh_ins', kind: 'weight', user: 'userId', day: 'day' },
  { collection: 'food_posts', kind: 'post', user: 'userId', at: 'createdAt', match: { deleted: { $ne: true }, repostOf: { $exists: false } } },
  { collection: 'post_comments', kind: 'social', user: 'userId', at: 'createdAt' },
  { collection: 'post_likes', kind: 'social', user: 'userId', at: 'createdAt' },
  { collection: 'messages', kind: 'social', user: 'senderId', at: 'createdAt' },
];

type Pair = { userId: string; day: string };

/** The database calls behind the report, so a test can stand in for Mongo. */
export interface UsageStore {
  /** Distinct (person, day) pairs of one source since a day. */
  pairs(source: UsageSource, sinceDay: string, today: string): Promise<Pair[]>;
  signups(sinceDay: string): Promise<Pair[]>;
  accounts(): Promise<number>;
}
export const USAGE_STORE = 'USAGE_STORE';

const DAY_MS = 24 * 60 * 60 * 1000;
/** A day before the day starts in UTC, so no zone's day is cut short; days are filtered after. */
const startOf = (day: string) => new Date(new Date(day + 'T00:00:00Z').getTime() - DAY_MS);
const field = (name: string) => '$' + name;
const dayOf = (name: string) => ({ $dateToString: { format: '%Y-%m-%d', date: field(name), timezone: USAGE_TIMEZONE } });

@Injectable()
export class MongoUsageStore implements UsageStore {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  async pairs(source: UsageSource, sinceDay: string, today: string): Promise<Pair[]> {
    const day = source.day ? field(source.day) : dayOf(source.at as string);
    const match = source.day
      ? { [source.day]: { $gte: sinceDay, $lte: today } }
      : { [source.at as string]: { $gte: startOf(sinceDay) } };
    const rows = await this.connection
      .collection(source.collection)
      .aggregate<{ _id: { u: string; d: string } }>([
        { $match: { ...match, ...source.match } },
        { $group: { _id: { u: field(source.user), d: day } } },
      ])
      .toArray();
    return rows.map((row) => ({ userId: String(row._id.u), day: String(row._id.d) }));
  }

  async signups(sinceDay: string): Promise<Pair[]> {
    const rows = await this.connection
      .collection('users')
      .aggregate<{ _id: unknown; d: string }>([
        { $match: { createdAt: { $gte: startOf(sinceDay) } } },
        { $project: { d: dayOf('createdAt') } },
      ])
      .toArray();
    return rows.map((row) => ({ userId: String(row._id), day: row.d }));
  }

  accounts(): Promise<number> {
    return this.connection.collection('users').countDocuments({});
  }
}

/**
 * Numbers (roadmap step 3): how many people use the app and what for, for the developer. Read
 * straight from the records, by collection name, and reduced to counts by `usageReport()`; the
 * answer never holds an id. Beside `AccountService` this is the only code that reads other
 * modules' collections by name, and it only ever reads who and when.
 */
@Injectable()
export class UsageService {
  constructor(
    @Inject(USAGE_STORE) private readonly store: UsageStore,
    private readonly access: AccessService,
  ) {}

  async report(userId: string, range: UsageRange, today: string): Promise<UsageReport> {
    this.access.requireDeveloper(userId);
    const since = addDays(today, -(Math.max(range, USAGE_RETENTION_WINDOW_DAYS) - 1));
    const [totalAccounts, signups, ...perSource] = await Promise.all([
      this.store.accounts(),
      this.store.signups(since),
      ...USAGE_SOURCES.map((source) => this.store.pairs(source, since, today)),
    ]);
    const within = (pair: Pair) => pair.day >= since && pair.day <= today;
    const events: UsageEvent[] = perSource.flatMap((pairs, index) =>
      pairs.filter(within).map((pair) => ({ ...pair, kind: USAGE_SOURCES[index].kind })),
    );
    return usageReport({ today, range, totalAccounts, signups: signups.filter(within), events });
  }
}

const DAY_PATTERN = new RegExp('^[0-9]{4}-[0-9]{2}-[0-9]{2}$');

export class UsageQueryDto {
  @IsOptional() @Type(() => Number) @IsIn(USAGE_RANGES) range?: UsageRange;
  /** The developer's own calendar day; the server's day is not theirs. */
  @Matches(DAY_PATTERN) today!: string;
}

@Controller('usage')
export class UsageController {
  constructor(private readonly usage: UsageService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  report(@CurrentUser('userId') userId: string, @Query() query: UsageQueryDto): Promise<UsageReport> {
    return this.usage.report(userId, query.range ?? 30, query.today);
  }
}

@Module({
  controllers: [UsageController],
  providers: [UsageService, { provide: USAGE_STORE, useClass: MongoUsageStore }],
})
export class UsageModule {}
