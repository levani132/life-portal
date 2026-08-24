import { Body, Controller, Get, Module, Put } from '@nestjs/common';
import { ArrayMaxSize, IsArray, Matches } from 'class-validator';
import type { DashboardResponse, UserSettings } from '@life-portal/shared-types';
import { CurrentUser, Public } from '../auth/current-user.decorator';
import { Today } from '../common/today';
import { BoardsModule } from '../boards/boards.module';
import { CashflowModule } from '../cashflow/cashflow.module';
import { ItemsModule } from '../items/items.module';
import { LoansModule } from '../loans/loans.module';
import { NutritionModule } from '../nutrition/nutrition.module';
import { PersonalModule } from '../personal/personal.module';
import { SettingsModule, SettingsService } from '../settings/settings.module';
import { StocksModule } from '../stocks/stocks.module';
import { DashboardService } from './dashboard.service';

/**
 * The user's card arrangement: card ids in display order, following the `PUT .../order`
 * convention the boards module already uses for tasks.
 *
 * Bounded and pattern-checked so the field cannot be used as arbitrary storage — every id the
 * dashboard emits is `loans` or `board:epam` shaped. Unknown ids are not rejected: a client on
 * an older build may still know a card this deploy removed, and `arrangeWidgets` ignores them
 * rather than failing the whole write.
 */
export class WidgetOrderDto {
  @IsArray()
  @ArrayMaxSize(64)
  @Matches(/^[a-z0-9]{1,32}(:[a-z0-9_-]{1,64})?$/i, {
    each: true,
    message: 'order must contain dashboard card ids',
  })
  order!: string[];
}

@Controller()
export class DashboardController {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly settings: SettingsService,
  ) {}

  /** Every card and summary for the landing page, in one request. */
  @Get('dashboard')
  build(@CurrentUser('userId') userId: string, @Today() today: string): Promise<DashboardResponse> {
    return this.dashboard.build(userId, today);
  }

  /** Persists a rearrangement made by dragging the cards on the dashboard. */
  @Put('dashboard/order')
  async reorder(
    @CurrentUser('userId') userId: string,
    @Body() dto: WidgetOrderDto,
  ): Promise<{ order: UserSettings['widgetOrder'] }> {
    const settings = await this.settings.setWidgetOrder(userId, dto.order);
    return { order: settings.widgetOrder };
  }

  /** Unauthenticated liveness probe, so a free host's health check does not need a token. */
  @Public()
  @Get('health')
  health() {
    return { status: 'ok', uptimeSeconds: Math.round(process.uptime()) };
  }
}

@Module({
  imports: [
    LoansModule,
    CashflowModule,
    ItemsModule,
    StocksModule,
    BoardsModule,
    PersonalModule,
    NutritionModule,
    SettingsModule,
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
