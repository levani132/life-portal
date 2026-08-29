import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Injectable,
  Logger,
  Module,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CurrentUser } from '../auth/current-user.decorator';
import { Today } from '../common/today';
import { CONFIG, type AppConfig } from '../config/configuration';
import { FxModule, FxService } from '../fx/fx.module';
import { SettingsModule, SettingsService } from '../settings/settings.module';
import { FinnhubProvider } from './finnhub.provider';
import {
  CreateLotDto,
  ImportHistoryDto,
  SellLotDto,
  SetManualQuoteDto,
  UpdateLotDto,
  UpsertEsppPlanDto,
  UpsertTargetDto,
} from './stocks.dto';
import {
  EsppPlan,
  EsppPlanSchema,
  StockFundamentals,
  StockFundamentalsSchema,
  StockLot,
  StockLotSchema,
  StockPriceHistory,
  StockPriceHistorySchema,
  StockQuote,
  StockQuoteSchema,
  StockTarget,
  StockTargetSchema,
} from './stocks.schemas';
import { StocksService } from './stocks.service';

/**
 * Refreshes quotes once a day on weekday evenings.
 *
 * The constitution requires no always-on worker, so this is a convenience: every refresh is
 * also reachable at `POST /api/stocks/refresh`, which is what a free host that sleeps the
 * process will actually rely on.
 */
@Injectable()
export class QuoteRefreshJob {
  private readonly logger = new Logger(QuoteRefreshJob.name);

  constructor(
    private readonly stocks: StocksService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_10PM, { name: 'refresh-quotes' })
  async handle(): Promise<void> {
    if (this.config.disableSchedules) return;
    const result = await this.stocks.refreshAll();
    const refreshed = result.results.filter((r) => r.refreshed).length;
    this.logger.log(
      `Quote refresh: ${refreshed}/${result.results.length} symbols updated`,
    );
  }
}

@Controller('stocks')
export class StocksController {
  constructor(
    private readonly stocks: StocksService,
    private readonly settings: SettingsService,
    private readonly finnhub: FinnhubProvider,
    private readonly fx: FxService,
  ) {}

  /** Everything the detail page needs in one round trip. */
  @Get()
  async overview(
    @CurrentUser('userId') userId: string,
    @Today() today: string,
    @Query('esppThrough') esppThrough?: string,
  ) {
    const settings = await this.settings.get(userId);
    const display = await this.fx.displayFor(userId, today);
    const positions = await this.stocks.positions(userId, today);
    const [summary, espp, esppPlans, targets] = await Promise.all([
      this.stocks.summary(userId, today, {
        taxRate: settings.capitalGainsTaxRate,
        ...display,
      }),
      this.stocks.esppProjections(userId, today, esppThrough, positions),
      this.stocks.listEsppPlans(userId),
      this.stocks.listTargets(userId),
    ]);

    return {
      today,
      positions,
      summary,
      espp,
      esppPlans,
      targets,
      provider: {
        name: this.finnhub.isConfigured ? 'finnhub' : 'manual',
        live: this.finnhub.isConfigured,
        unavailableReason: this.finnhub.unavailableReason,
      },
    };
  }

  @Get('summary')
  async summary(@CurrentUser('userId') userId: string, @Today() today: string) {
    const settings = await this.settings.get(userId);
    const display = await this.fx.displayFor(userId, today);
    return this.stocks.summary(userId, today, {
      taxRate: settings.capitalGainsTaxRate,
      ...display,
    });
  }

  @Get('positions')
  positions(@CurrentUser('userId') userId: string, @Today() today: string) {
    return this.stocks.positions(userId, today);
  }

  @Get('history/:symbol')
  history(@Param('symbol') symbol: string) {
    return this.stocks.getHistory(symbol);
  }

  @Post('history/:symbol')
  importHistory(
    @Param('symbol') symbol: string,
    @Body() dto: ImportHistoryDto,
    @Today() today: string,
  ) {
    return this.stocks.importHistory(symbol, dto.points, today);
  }

  @Post('lots')
  createLot(@CurrentUser('userId') userId: string, @Body() dto: CreateLotDto) {
    return this.stocks.createLot(userId, dto);
  }

  @Get('lots')
  listLots(@CurrentUser('userId') userId: string) {
    return this.stocks.listLots(userId);
  }

  @Patch('lots/:id')
  updateLot(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateLotDto,
  ) {
    return this.stocks.updateLot(userId, id, dto);
  }

  @Post('lots/:id/sell')
  sellLot(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: SellLotDto,
    @Today() today: string,
  ) {
    return this.stocks.sellLot(userId, id, dto, today);
  }

  @Delete('lots/:id')
  removeLot(@CurrentUser('userId') userId: string, @Param('id') id: string) {
    return this.stocks.removeLot(userId, id);
  }

  @Get('targets')
  listTargets(@CurrentUser('userId') userId: string) {
    return this.stocks.listTargets(userId);
  }

  @Put('targets')
  upsertTarget(
    @CurrentUser('userId') userId: string,
    @Body() dto: UpsertTargetDto,
  ) {
    return this.stocks.upsertTarget(userId, dto);
  }

  @Delete('targets/:symbol')
  removeTarget(
    @CurrentUser('userId') userId: string,
    @Param('symbol') symbol: string,
  ) {
    return this.stocks.removeTarget(userId, symbol);
  }

  @Put('quote')
  setManualQuote(@Body() dto: SetManualQuoteDto, @Today() today: string) {
    return this.stocks.setManualQuote(dto, today);
  }

  /** On-demand refresh. The scheduled job calls the same code path. */
  @Post('refresh')
  refresh(@CurrentUser('userId') userId: string, @Today() today: string) {
    return this.stocks.refreshAll(userId, today);
  }

  /** Fetches peer fundamentals, which the suggested target needs. Several API calls. */
  @Post('refresh-fundamentals/:symbol')
  refreshFundamentals(@Param('symbol') symbol: string, @Today() today: string) {
    return this.stocks.refreshFundamentals(symbol, today);
  }

  @Get('espp')
  listEspp(@CurrentUser('userId') userId: string) {
    return this.stocks.listEsppPlans(userId);
  }

  @Get('espp/projection')
  esppProjection(
    @CurrentUser('userId') userId: string,
    @Today() today: string,
    @Query('through') through?: string,
  ) {
    return this.stocks.esppProjections(userId, today, through);
  }

  @Put('espp')
  upsertEspp(
    @CurrentUser('userId') userId: string,
    @Body() dto: UpsertEsppPlanDto,
  ) {
    return this.stocks.upsertEsppPlan(userId, dto);
  }
}

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: StockLot.name, schema: StockLotSchema },
      { name: StockQuote.name, schema: StockQuoteSchema },
      { name: StockPriceHistory.name, schema: StockPriceHistorySchema },
      { name: StockFundamentals.name, schema: StockFundamentalsSchema },
      { name: StockTarget.name, schema: StockTargetSchema },
      { name: EsppPlan.name, schema: EsppPlanSchema },
    ]),
    SettingsModule,
    FxModule,
  ],
  controllers: [StocksController],
  providers: [StocksService, FinnhubProvider, QuoteRefreshJob],
  exports: [StocksService],
})
export class StocksModule {}
