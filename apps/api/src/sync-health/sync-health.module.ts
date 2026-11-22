import { Controller, Get, Module, Query } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Type } from 'class-transformer';
import { IsIn } from 'class-validator';
import { SYNC_HEALTH_RANGES } from '@life-portal/shared-types';
import { CurrentUser } from '../auth/current-user.decorator';
import { SyncHealthDaily, SyncHealthDailySchema, SyncHealthService } from './sync-health.service';
import { AsPerson } from '../auth/acting';

export class SyncHealthReportDto {
  @Type(() => Number) @IsIn(SYNC_HEALTH_RANGES) range = 7;
}

/** Issue #22: content-free sync counters. Written by the idempotency interceptor. */
@AsPerson()
@Controller('sync-health')
export class SyncHealthController {
  constructor(private readonly health: SyncHealthService) {}

  /** Developer only: daily counts, never per account. */
  @Get() report(@CurrentUser('userId') userId: string, @Query() query: SyncHealthReportDto) {
    return this.health.report(userId, query.range);
  }
}

@Module({
  imports: [MongooseModule.forFeature([{ name: SyncHealthDaily.name, schema: SyncHealthDailySchema }])],
  controllers: [SyncHealthController],
  providers: [SyncHealthService],
  exports: [SyncHealthService],
})
export class SyncHealthModule {}
