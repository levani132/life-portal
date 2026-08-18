import { Controller, Get, Module } from '@nestjs/common';
import type { DashboardResponse } from '@life-portal/shared-types';
import { CurrentUser, Public } from '../auth/current-user.decorator';
import { Today } from '../common/today';
import { BoardsModule } from '../boards/boards.module';
import { CashflowModule } from '../cashflow/cashflow.module';
import { ItemsModule } from '../items/items.module';
import { LoansModule } from '../loans/loans.module';
import { PersonalModule } from '../personal/personal.module';
import { SettingsModule } from '../settings/settings.module';
import { StocksModule } from '../stocks/stocks.module';
import { DashboardService } from './dashboard.service';

@Controller()
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  /** Every card and summary for the landing page, in one request. */
  @Get('dashboard')
  build(@CurrentUser('userId') userId: string, @Today() today: string): Promise<DashboardResponse> {
    return this.dashboard.build(userId, today);
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
    SettingsModule,
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
