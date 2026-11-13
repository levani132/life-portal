import { Body, Controller, Delete, Get, Injectable, Logger, Module, Param, Post, UseInterceptors } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { IsIn, IsInt, IsMongoId, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { TOURNAMENT_CATEGORIES, type TournamentCategory } from '@life-portal/shared-types';
import { RequireModule } from '../access/access.module';
import { CurrentUser } from '../auth/current-user.decorator';
import { SocialModule, SocialNoStore } from '../social/social.module';
import { TrainingModule } from '../training/training.module';
import {
  TournamentEntryRecord,
  TournamentEntrySchema,
  TournamentGroupRecord,
  TournamentGroupSchema,
  TournamentLockRecord,
  TournamentLockSchema,
  TournamentReminderRecord,
  TournamentReminderSchema,
} from './tournaments.schemas';
import { TournamentsService } from './tournaments.service';

export class JoinTournamentDto {
  @IsMongoId() exerciseId!: string;
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'season must be YYYY-MM' }) season!: string;
  @IsIn(TOURNAMENT_CATEGORIES) category!: TournamentCategory;
  @IsInt() consentVersion!: number;
}

export class VoidEntryDto {
  @IsString() @MinLength(3) @MaxLength(300) reason!: string;
}

/** All private, no-store: entries and groups are about named people. */
@RequireModule('training')
@UseInterceptors(SocialNoStore)
@Controller('tournaments')
class TournamentsController {
  constructor(private readonly tournaments: TournamentsService) {}

  @Get() overview(@CurrentUser('userId') userId: string) {
    return this.tournaments.overview(userId);
  }
  @Post('entries') join(@CurrentUser('userId') userId: string, @Body() dto: JoinTournamentDto) {
    return this.tournaments.join(userId, dto);
  }
  @Delete('entries/:id') withdraw(@CurrentUser('userId') userId: string, @Param('id') id: string) {
    return this.tournaments.withdraw(userId, id);
  }
  /** Developer only (checked in the service). */
  @Post('entries/:id/void') voidEntry(@CurrentUser('userId') userId: string, @Param('id') id: string, @Body() dto: VoidEntryDto) {
    return this.tournaments.voidEntry(userId, id, dto.reason);
  }
  @Get('groups/:id') group(@CurrentUser('userId') userId: string, @Param('id') id: string) {
    return this.tournaments.group(userId, id);
  }
}

/**
 * Hourly: form due groups, freeze due results, and send the enrolment reminder once per season.
 * Each step is idempotent and retried by the next run if it failed. Off with `DISABLE_SCHEDULES`.
 */
@Injectable()
class TournamentJobs {
  private readonly logger = new Logger(TournamentJobs.name);
  constructor(private readonly tournaments: TournamentsService) {}

  @Cron(CronExpression.EVERY_HOUR, { name: 'tournament-lock' })
  async lock() {
    if (this.tournaments.schedulesDisabled) return;
    const formed = await this.tournaments.lockDue();
    if (formed) this.logger.log(`Formed tournament groups for ${formed} exercise(s)`);
    const finalized = await this.tournaments.finalizeDue();
    if (finalized) this.logger.log(`Froze results for ${finalized} tournament group(s)`);
    const reminded = await this.tournaments.remindEnrollmentOpen().catch((error: unknown) => {
      this.logger.warn(`Enrolment reminder failed: ${error instanceof Error ? error.message : 'unknown error'}`);
      return 0;
    });
    if (reminded) this.logger.log(`Sent the enrolment reminder to ${reminded} member(s)`);
  }
}

@Module({
  imports: [
    TrainingModule,
    SocialModule,
    MongooseModule.forFeature([
      { name: TournamentEntryRecord.name, schema: TournamentEntrySchema },
      { name: TournamentGroupRecord.name, schema: TournamentGroupSchema },
      { name: TournamentLockRecord.name, schema: TournamentLockSchema },
      { name: TournamentReminderRecord.name, schema: TournamentReminderSchema },
    ]),
  ],
  controllers: [TournamentsController],
  providers: [TournamentsService, TournamentJobs],
  exports: [TournamentsService],
})
export class TournamentsModule {}
