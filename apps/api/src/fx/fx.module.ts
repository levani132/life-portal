import {
  Controller,
  Get,
  Inject,
  Injectable,
  Logger,
  Module,
  type OnModuleInit,
  Post,
  Query,
} from '@nestjs/common';
import { InjectModel, MongooseModule } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Model } from 'mongoose';
import type {
  Currency,
  FxContext,
  FxRateHistory as FxRateHistoryDto,
  FxRatePoint,
} from '@life-portal/shared-types';
import {
  addDays,
  eachDay,
  fxContext,
  ratePointFor,
  toDay,
} from '@life-portal/shared-domain';
import { CONFIG, type AppConfig } from '../config/configuration';
import { Today } from '../common/today';
import { FX_BASE_CURRENCY, NbgProvider } from './nbg.provider';
import { FxRateHistory, FxRateHistorySchema } from './fx.schemas';

@Injectable()
export class FxService {
  private readonly logger = new Logger(FxService.name);

  constructor(
    @InjectModel(FxRateHistory.name)
    private readonly history: Model<FxRateHistory>,
    private readonly nbg: NbgProvider,
  ) {}

  /** The whole archive for the base currency, or `null` before the first successful fetch. */
  async archive(): Promise<FxRateHistoryDto | null> {
    const found = await this.history.findOne({ base: FX_BASE_CURRENCY });
    return found ? (found.toJSON() as unknown as FxRateHistoryDto) : null;
  }

  /**
   * The rates to render `day` with, in `displayCurrency`.
   *
   * Takes the currency rather than a `userId` on purpose: every caller already has the user's
   * settings in hand, and reaching for `SettingsService` here would make two modules import
   * each other.
   */
  async context(displayCurrency: Currency, day: string): Promise<FxContext> {
    return fxContext(await this.archive(), day, displayCurrency);
  }

  /**
   * Fetches the published rates and files them under the day they are *valid from*.
   *
   * Idempotent: re-running on the same day corrects that day's point rather than appending a
   * second one, the same way `stock_price_history` is grown.
   */
  async refresh(
    day?: string,
  ): Promise<{
    refreshed: boolean;
    date?: string;
    rates?: Record<string, number>;
  }> {
    const point = await this.nbg.fetchRates(day);
    if (!point) return { refreshed: false };
    await this.store([point]);
    return { refreshed: true, date: point.date, rates: point.rates };
  }

  /**
   * Fills the archive for a past range, one request per day.
   *
   * Needed because the archive starts empty and `ratePointFor` refuses to extrapolate
   * backwards: without a backfill, every amount recorded before the app's first run would stay
   * unconverted forever. Days already held are skipped, so re-running is cheap.
   */
  async backfill(
    from: string,
    to: string,
  ): Promise<{ added: number; failed: number }> {
    const archive = await this.archive();
    const held = new Set((archive?.points ?? []).map((p) => p.date));
    const days = eachDay(toDay(from), toDay(to)).filter(
      (day) => !held.has(day),
    );

    const points = new Map<string, FxRatePoint>();
    let failed = 0;
    // Sequential on purpose: this is a courtesy to a free public endpoint, and a backfill is
    // never on a user-facing path.
    for (const day of days) {
      const point = await this.nbg.fetchRates(day);
      // Asking for a Saturday answers with Friday's rate, carrying Friday's `validFromDate`.
      // Keying by that date is what collapses a weekend into the one publication it belongs to,
      // so `added` counts rates actually filed rather than requests made.
      if (point) points.set(point.date, point);
      else failed += 1;
    }
    if (points.size) await this.store([...points.values()]);
    return { added: points.size, failed };
  }

  /** Upserts points by date, so re-running a day corrects it rather than duplicating it. */
  private async store(points: FxRatePoint[]): Promise<void> {
    const existing = await this.history.findOne({ base: FX_BASE_CURRENCY });
    const latest = points
      .map((p) => p.date)
      .sort()
      .at(-1) as string;

    if (!existing) {
      await this.history.create({
        base: FX_BASE_CURRENCY,
        points: [...points].sort((a, b) => (a.date < b.date ? -1 : 1)),
        fetchedAt: latest,
      });
      return;
    }

    for (const point of points) {
      const index = existing.points.findIndex((p) => p.date === point.date);
      if (index >= 0) existing.points[index].rates = point.rates;
      else existing.points.push({ date: point.date, rates: point.rates });
    }
    existing.points.sort((a, b) => (a.date < b.date ? -1 : 1));
    if (latest > existing.fetchedAt) existing.fetchedAt = latest;
    await existing.save();
  }

  /**
   * Guarantees a rate exists for `today`, asking for that day by name.
   *
   * Requesting the day explicitly is the whole point: an unparameterised call late in the
   * evening files tomorrow's rate, leaving today with none and every figure unconverted.
   */
  async ensureRatesFor(today: string): Promise<void> {
    const archive = await this.archive();
    if (ratePointFor(archive, today)) return;
    await this.refresh(today);
  }
}

/**
 * Keeps the archive current.
 *
 * Runs in the **morning**, unlike the quote refresh: the NBG publishes a rate in the evening
 * marked valid from the *following* day, so an evening job would only ever file tomorrow's
 * rate and today would forever fall back to yesterday's.
 *
 * `onModuleInit` covers the same ground for a host that sleeps the process and so may never
 * be awake at 6am — and it is what fills the archive the very first time the app boots.
 */
/** How far back the archive is filled on first boot. Long enough to cover recorded history. */
const BACKFILL_DAYS = 120;

@Injectable()
export class FxRefreshJob implements OnModuleInit {
  private readonly logger = new Logger(FxRefreshJob.name);

  constructor(
    private readonly fx: FxService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.config.disableSchedules) return;
    const today = new Date().toISOString().slice(0, 10);
    try {
      await this.fx.ensureRatesFor(today);
    } catch (error) {
      // Never block boot on an outside service.
      this.logger.warn(
        `Initial FX top-up failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // History, on the other hand, is one request per day and must not hold boot open, so it
    // runs detached. An amount older than the archive stays unconverted until this lands.
    void this.fx
      .backfill(addDays(today, -BACKFILL_DAYS), today)
      .then(({ added, failed }) => {
        if (added || failed)
          this.logger.log(
            `FX backfill: ${added} day(s) added, ${failed} failed`,
          );
      })
      .catch((error) =>
        this.logger.warn(`FX backfill failed: ${String(error)}`),
      );
  }

  @Cron(CronExpression.EVERY_DAY_AT_6AM, { name: 'refresh-fx-rates' })
  async handle(): Promise<void> {
    if (this.config.disableSchedules) return;
    const today = new Date().toISOString().slice(0, 10);
    const result = await this.fx.refresh(today);
    this.logger.log(
      result.refreshed
        ? `FX rates updated for ${result.date}`
        : 'FX refresh returned nothing',
    );
  }
}

@Controller('fx')
export class FxController {
  constructor(private readonly fx: FxService) {}

  /** The archive plus the rates in force today, for the settings screen. */
  @Get()
  async current(@Today() today: string) {
    const archive = await this.fx.archive();
    return {
      today,
      base: FX_BASE_CURRENCY,
      inForce: ratePointFor(archive, today) ?? null,
      fetchedAt: archive?.fetchedAt ?? null,
      pointCount: archive?.points.length ?? 0,
    };
  }

  /**
   * Manual refresh. Present for the same reason `POST /stocks/refresh` is: a free host that
   * sleeps the process cannot be relied on to run a cron.
   */
  @Post('refresh')
  refresh(@Today() today: string) {
    return this.fx.refresh(today);
  }

  /** Fills a past range. `?from=` defaults to 120 days back, `?to=` to today. */
  @Post('backfill')
  backfill(
    @Today() today: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.fx.backfill(from ?? addDays(today, -120), to ?? today);
  }
}

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: FxRateHistory.name, schema: FxRateHistorySchema },
    ]),
  ],
  controllers: [FxController],
  providers: [FxService, NbgProvider, FxRefreshJob],
  exports: [FxService],
})
export class FxModule {}
