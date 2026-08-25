import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from '../auth/auth.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BoardsModule } from '../boards/boards.module';
import { CashflowModule } from '../cashflow/cashflow.module';
import { ConfigModule } from '../config/config.module';
import { loadConfig } from '../config/configuration';
import { DashboardModule } from '../dashboard/dashboard.module';
import { FxModule } from '../fx/fx.module';
import { ItemsModule } from '../items/items.module';
import { LoansModule } from '../loans/loans.module';
import { NutritionModule } from '../nutrition/nutrition.module';
import { PersonalModule } from '../personal/personal.module';
import { SettingsModule } from '../settings/settings.module';
import { StocksModule } from '../stocks/stocks.module';

@Module({
  imports: [
    ConfigModule,
    MongooseModule.forRootAsync({
      useFactory: () => ({
        uri: loadConfig().mongoUri,
        // Fail fast on a bad URI rather than hanging the first request for 30 seconds.
        serverSelectionTimeoutMS: 10_000,
      }),
    }),
    ScheduleModule.forRoot(),
    AuthModule,
    SettingsModule,
    FxModule,
    CashflowModule,
    LoansModule,
    ItemsModule,
    StocksModule,
    BoardsModule,
    PersonalModule,
    NutritionModule,
    DashboardModule,
  ],
  providers: [
    // Guarding globally means a new controller ships authenticated unless it opts out with
    // `@Public()`, rather than the other way round.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
