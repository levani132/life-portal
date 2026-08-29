import {
  Body,
  Controller,
  Delete,
  Get,
  Module,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import type { Request } from 'express';
import { CurrentUser, TokenAuth } from '../auth/current-user.decorator';
import { resolveToday, Today } from '../common/today';
import { CashflowModule } from '../cashflow/cashflow.module';
import { FxModule } from '../fx/fx.module';
import { NutritionModule } from '../nutrition/nutrition.module';
import { SettingsModule, SettingsService } from '../settings/settings.module';
import { IngestTokenGuard, type IngestContext } from './ingest-token.guard';
import { IngestTokenService } from './ingest-token.service';
import {
  CreateIngestTokenDto,
  CreatePaymentDto,
  IngestDto,
  PromotePurposeDto,
  SetDecisionDto,
  SetSpendOrderDto,
  UpdatePaymentDto,
} from './spending.dto';
import {
  IngestToken,
  IngestTokenSchema,
  SpendPayment,
  SpendPaymentSchema,
} from './spending.schemas';
import { SpendingService } from './spending.service';

/**
 * The one route a phone automation calls.
 *
 * Its own controller so the header-authenticated route cannot accidentally acquire a JWT-guarded
 * neighbour, or the reverse.
 */
@Controller('spending')
export class SpendingIngestController {
  constructor(
    private readonly spending: SpendingService,
    private readonly tokens: IngestTokenService,
  ) {}

  /**
   * Always answers 2xx, even for a message it cannot read.
   *
   * A Shortcut has no error handling: anything other than success means the message is lost for
   * good. An unreadable one is stored verbatim and queued for the owner instead.
   */
  @Post('ingest')
  @TokenAuth()
  @UseGuards(IngestTokenGuard)
  async ingest(@Req() request: Request & { ingest?: IngestContext }, @Body() dto: IngestDto) {
    const { userId, tokenId } = request.ingest as IngestContext;
    const receivedAt = new Date().toISOString();
    const result = await this.spending.ingest(userId, dto, receivedAt);
    // Stamped only once a submission is accepted, so "capture is working" means a message really
    // landed rather than that something once presented a credential.
    await this.tokens.markUsed(tokenId, receivedAt);
    return result;
  }
}

@Controller('spending')
export class SpendingController {
  constructor(
    private readonly spending: SpendingService,
    private readonly tokens: IngestTokenService,
    private readonly settings: SettingsService,
  ) {}

  /** Everything the detail page needs in one round trip: ladder, figures, payments, gaps. */
  @Get()
  overview(@CurrentUser('userId') userId: string, @Today() today: string) {
    return this.spending.overview(userId, today);
  }

  /** One day read allowance-first: what was spent on it, whichever day paid for it. */
  @Get('day')
  day(@CurrentUser('userId') userId: string, @Today() today: string, @Query('date') date?: string) {
    return this.spending.day(userId, today, resolveToday(date));
  }

  /** Per-period and cumulative savings, plus the month's projected, actual and extra together. */
  @Get('savings')
  savings(
    @CurrentUser('userId') userId: string,
    @Today() today: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.spending.savings(userId, today, from, to);
  }

  @Get('payments')
  payments(
    @CurrentUser('userId') userId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('status') status?: string,
  ) {
    return this.spending.list(userId, from, to, status);
  }

  @Post('payments')
  create(
    @CurrentUser('userId') userId: string,
    @Today() today: string,
    @Body() dto: CreatePaymentDto,
  ) {
    return this.spending.create(userId, today, dto);
  }

  @Patch('payments/:id')
  update(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdatePaymentDto,
  ) {
    return this.spending.update(userId, id, dto);
  }

  @Delete('payments/:id')
  remove(@CurrentUser('userId') userId: string, @Param('id') id: string) {
    return this.spending.remove(userId, id);
  }

  @Put('payments/:id/decision')
  decide(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Today() today: string,
    @Body() dto: SetDecisionDto,
  ) {
    return this.spending.setDecision(userId, id, today, dto);
  }

  @Post('payments/:id/promote')
  promote(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Today() today: string,
    @Body() dto: PromotePurposeDto,
  ) {
    return this.spending.promote(userId, id, today, dto);
  }

  /**
   * The order the ladder fills its rungs.
   *
   * Ids across every tier in one list; within a tier, rungs sort by their index. Unknown ids are
   * tolerated and unlisted expenses fall to the end — the same preference-list behaviour as
   * `widgetOrder`, because expenses come and go.
   */
  @Put('order')
  setOrder(@CurrentUser('userId') userId: string, @Body() dto: SetSpendOrderDto) {
    return this.settings.setSpendOrder(userId, dto.order);
  }

  // ------------------------------------------------------------ budget proposals

  /**
   * Revised budgets the owner's own spending suggests, each carrying the working behind it.
   *
   * A read. Nothing here changes a budget — accepting one does, and only the owner can (FR-036).
   */
  @Get('suggestions')
  suggestions(@CurrentUser('userId') userId: string, @Today() today: string) {
    return this.spending.suggestions(userId, today);
  }

  /** Applies the proposal, through `CashflowService`, which owns the expense. */
  @Post('suggestions/:expenseId/accept')
  acceptSuggestion(
    @CurrentUser('userId') userId: string,
    @Param('expenseId') expenseId: string,
    @Today() today: string,
  ) {
    return this.spending.acceptSuggestion(userId, expenseId, today);
  }

  /** Records the figure refused, so the same one is not proposed again immediately. */
  @Post('suggestions/:expenseId/dismiss')
  dismissSuggestion(
    @CurrentUser('userId') userId: string,
    @Param('expenseId') expenseId: string,
    @Today() today: string,
  ) {
    return this.spending.dismissSuggestion(userId, expenseId, today);
  }

  /** Messages the app can prove never arrived. Never a balance — see the module doc. */
  @Get('gaps')
  gaps(@CurrentUser('userId') userId: string) {
    return this.spending.gaps(userId);
  }

  // ---------------------------------------------------------------- tokens

  @Get('tokens')
  listTokens(@CurrentUser('userId') userId: string) {
    return this.tokens.list(userId);
  }

  /** The only response that ever carries a plain token value. */
  @Post('tokens')
  createToken(@CurrentUser('userId') userId: string, @Body() dto: CreateIngestTokenDto) {
    return this.tokens.create(userId, dto.label, dto.expiresAt);
  }

  @Delete('tokens/:id')
  revokeToken(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Today() today: string,
  ) {
    return this.tokens.revoke(userId, id, today);
  }
}

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SpendPayment.name, schema: SpendPaymentSchema },
      { name: IngestToken.name, schema: IngestTokenSchema },
    ]),
    CashflowModule,
    SettingsModule,
    FxModule,
    NutritionModule,
  ],
  controllers: [SpendingIngestController, SpendingController],
  providers: [SpendingService, IngestTokenService, IngestTokenGuard],
  exports: [SpendingService],
})
export class SpendingModule {}
