import { Body, Controller, Delete, Get, Module, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CurrentUser } from '../auth/current-user.decorator';
import { Today } from '../common/today';
import {
  SetBalanceDto,
  UpdateExpenseDto,
  UpdateIncomeDto,
  UpsertExpenseDto,
  UpsertIncomeDto,
} from './cashflow.dto';
import {
  CashBalance,
  CashBalanceSchema,
  Expense,
  ExpenseSchema,
  IncomeSource,
  IncomeSourceSchema,
} from './cashflow.schemas';
import { CashflowService } from './cashflow.service';

@Controller('cashflow')
export class CashflowController {
  constructor(private readonly cashflow: CashflowService) {}

  /** Everything the detail page needs in one round trip. */
  @Get()
  async overview(
    @CurrentUser('userId') userId: string,
    @Today() today: string,
    @Query('to') to?: string,
    @Query('snapshotDate') snapshotDate?: string,
  ) {
    const [summary, projection, incomes, expenses, breakdown, balanceHistory] = await Promise.all([
      this.cashflow.summary(userId, today),
      this.cashflow.projection(userId, today, { to: to ?? this.cashflow.defaultTo(today), snapshotDate }),
      this.cashflow.listIncomes(userId),
      this.cashflow.listExpenses(userId),
      this.cashflow.monthlyBreakdown(userId),
      this.cashflow.balanceHistory(userId),
    ]);
    return { today, summary, projection, incomes, expenses, breakdown, balanceHistory };
  }

  @Get('summary')
  summary(@CurrentUser('userId') userId: string, @Today() today: string) {
    return this.cashflow.summary(userId, today);
  }

  /** "How much will I have on date X, and how much of it is free?" */
  @Get('snapshot')
  async snapshot(
    @CurrentUser('userId') userId: string,
    @Today() today: string,
    @Query('date') date?: string,
  ) {
    const target = date ?? today;
    const projection = await this.cashflow.projection(userId, today, {
      to: target > this.cashflow.defaultTo(today) ? target : this.cashflow.defaultTo(today),
      snapshotDate: target,
    });
    return projection.snapshot;
  }

  @Get('balance')
  balance(@CurrentUser('userId') userId: string, @Today() today: string) {
    return this.cashflow.currentBalance(userId, today);
  }

  @Put('balance')
  setBalance(@CurrentUser('userId') userId: string, @Today() today: string, @Body() dto: SetBalanceDto) {
    return this.cashflow.setBalance(userId, today, dto);
  }

  @Get('incomes')
  listIncomes(@CurrentUser('userId') userId: string) {
    return this.cashflow.listIncomes(userId);
  }

  @Post('incomes')
  createIncome(@CurrentUser('userId') userId: string, @Body() dto: UpsertIncomeDto) {
    return this.cashflow.createIncome(userId, dto);
  }

  @Patch('incomes/:id')
  updateIncome(@CurrentUser('userId') userId: string, @Param('id') id: string, @Body() dto: UpdateIncomeDto) {
    return this.cashflow.updateIncome(userId, id, dto);
  }

  @Delete('incomes/:id')
  removeIncome(@CurrentUser('userId') userId: string, @Param('id') id: string) {
    return this.cashflow.removeIncome(userId, id);
  }

  @Get('expenses')
  listExpenses(@CurrentUser('userId') userId: string) {
    return this.cashflow.listExpenses(userId);
  }

  @Post('expenses')
  createExpense(@CurrentUser('userId') userId: string, @Body() dto: UpsertExpenseDto) {
    return this.cashflow.createExpense(userId, dto);
  }

  @Patch('expenses/:id')
  updateExpense(@CurrentUser('userId') userId: string, @Param('id') id: string, @Body() dto: UpdateExpenseDto) {
    return this.cashflow.updateExpense(userId, id, dto);
  }

  @Delete('expenses/:id')
  removeExpense(@CurrentUser('userId') userId: string, @Param('id') id: string) {
    return this.cashflow.removeExpense(userId, id);
  }
}

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CashBalance.name, schema: CashBalanceSchema },
      { name: IncomeSource.name, schema: IncomeSourceSchema },
      { name: Expense.name, schema: ExpenseSchema },
    ]),
  ],
  controllers: [CashflowController],
  providers: [CashflowService],
  exports: [CashflowService],
})
export class CashflowModule {}
