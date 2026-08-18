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
} from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { IsArray, IsMongoId } from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator';
import { Today } from '../common/today';
import { CashflowModule } from '../cashflow/cashflow.module';
import { ItemsModule } from '../items/items.module';
import { SettingsModule } from '../settings/settings.module';
import { StocksModule } from '../stocks/stocks.module';
import {
  CreateLoanDto,
  CreatePaymentDto,
  CreatePlanDto,
  UpdateLoanDto,
  UpdatePaymentDto,
  UpdatePlanDto,
} from './loans.dto';
import { Loan, LoanPayment, LoanPaymentSchema, LoanSchema, RepaymentPlan, RepaymentPlanSchema } from './loans.schemas';
import { LoansService } from './loans.service';

export class ReprioritiseDto {
  @IsArray()
  @IsMongoId({ each: true })
  order!: string[];
}

@Controller('loans')
export class LoansController {
  constructor(private readonly loans: LoansService) {}

  /** Every loan with balances, plans and scenarios — the widget's index page. */
  @Get()
  async overview(@CurrentUser('userId') userId: string, @Today() today: string) {
    const [loans, summary] = await Promise.all([
      this.loans.listWithDetail(userId, today),
      this.loans.summary(userId, today),
    ]);
    return { today, loans, summary };
  }

  @Get('summary')
  summary(@CurrentUser('userId') userId: string, @Today() today: string) {
    return this.loans.summary(userId, today);
  }

  @Post()
  create(@CurrentUser('userId') userId: string, @Body() dto: CreateLoanDto) {
    return this.loans.create(userId, dto);
  }

  @Put('priority')
  reprioritise(@CurrentUser('userId') userId: string, @Body() dto: ReprioritiseDto) {
    return this.loans.reprioritise(userId, dto.order);
  }

  @Get(':id')
  detail(@CurrentUser('userId') userId: string, @Param('id') id: string, @Today() today: string) {
    return this.loans.detail(userId, id, today);
  }

  @Patch(':id')
  update(@CurrentUser('userId') userId: string, @Param('id') id: string, @Body() dto: UpdateLoanDto) {
    return this.loans.update(userId, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser('userId') userId: string, @Param('id') id: string) {
    return this.loans.remove(userId, id);
  }

  @Get(':id/payments')
  listPayments(@CurrentUser('userId') userId: string, @Param('id') id: string) {
    return this.loans.listPayments(userId, id);
  }

  @Post(':id/payments')
  addPayment(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: CreatePaymentDto,
    @Today() today: string,
  ) {
    return this.loans.addPayment(userId, id, dto, today);
  }

  @Patch('payments/:paymentId')
  updatePayment(
    @CurrentUser('userId') userId: string,
    @Param('paymentId') paymentId: string,
    @Body() dto: UpdatePaymentDto,
  ) {
    return this.loans.updatePayment(userId, paymentId, dto);
  }

  @Delete('payments/:paymentId')
  removePayment(@CurrentUser('userId') userId: string, @Param('paymentId') paymentId: string) {
    return this.loans.removePayment(userId, paymentId);
  }

  @Get(':id/plans')
  listPlans(@CurrentUser('userId') userId: string, @Param('id') id: string) {
    return this.loans.listPlans(userId, id);
  }

  @Post(':id/plans')
  addPlan(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: CreatePlanDto,
    @Today() today: string,
  ) {
    return this.loans.addPlan(userId, id, dto, today);
  }

  @Patch('plans/:planId')
  updatePlan(
    @CurrentUser('userId') userId: string,
    @Param('planId') planId: string,
    @Body() dto: UpdatePlanDto,
  ) {
    return this.loans.updatePlan(userId, planId, dto);
  }

  @Delete('plans/:planId')
  removePlan(
    @CurrentUser('userId') userId: string,
    @Param('planId') planId: string,
    @Query('keepExpense') keepExpense?: string,
  ) {
    return this.loans.removePlan(userId, planId, { keepExpense: keepExpense === 'true' });
  }
}

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Loan.name, schema: LoanSchema },
      { name: LoanPayment.name, schema: LoanPaymentSchema },
      { name: RepaymentPlan.name, schema: RepaymentPlanSchema },
    ]),
    CashflowModule,
    ItemsModule,
    StocksModule,
    SettingsModule,
  ],
  controllers: [LoansController],
  providers: [LoansService],
  exports: [LoansService],
})
export class LoansModule {}
