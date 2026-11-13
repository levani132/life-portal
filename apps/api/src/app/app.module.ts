import { PostsModule } from '../posts/posts.module';
import { SocialModule } from '../social/social.module';
import { SocialGraphModule } from '../social-graph/social-graph.module';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { AccessModule, ModuleAccessGuard } from '../access/access.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { MessagesModule } from '../messages/messages.module';
import { PortalModule } from '../portal/portal.module';
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
import { McpModule } from '../mcp/mcp.module';
import { NutritionModule } from '../nutrition/nutrition.module';
import { TrainingModule } from '../training/training.module';
import { BadgesModule } from '../badges/badges.module';
import { TournamentsModule } from '../tournaments/tournaments.module';
import { PersonalModule } from '../personal/personal.module';
import { SettingsModule } from '../settings/settings.module';
import { SpendingModule } from '../spending/spending.module';
import { StocksModule } from '../stocks/stocks.module';
import { StorageModule } from '../storage/storage.module';
import { MediaModule } from '../media/media.module';

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
    StorageModule,
    MediaModule,
    AuthModule,
    AccessModule,
    SocialGraphModule,
    NotificationsModule,
    SocialModule,
    PostsModule,
    MessagesModule,
    PortalModule,
    SettingsModule,
    FxModule,
    CashflowModule,
    LoansModule,
    ItemsModule,
    StocksModule,
    BoardsModule,
    PersonalModule,
    NutritionModule,
    TrainingModule,
    BadgesModule,
    TournamentsModule,
    SpendingModule,
    DashboardModule,
    McpModule,
  ],
  providers: [
    // Guarding globally means a new controller ships authenticated unless it opts out with
    // `@Public()`, rather than the other way round.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: ModuleAccessGuard },
  ],
})
export class AppModule {}
