import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model } from 'mongoose';
import type {
  CashBalance as CashBalanceDto,
  CashProjection,
  CashflowSummary,
  Currency,
  Expense as ExpenseDto,
  IncomeSource as IncomeSourceDto,
} from '@life-portal/shared-types';
import {
  addDays,
  addMonths,
  defaultHorizon,
  monthlyEquivalentCents,
  nextOccurrence,
  projectCash,
  runwayDays,
  snapshotAt,
  toDay,
} from '@life-portal/shared-domain';
import { CashBalance, Expense, IncomeSource } from './cashflow.schemas';
import type { SetBalanceDto, UpdateExpenseDto, UpdateIncomeDto, UpsertExpenseDto, UpsertIncomeDto } from './cashflow.dto';

@Injectable()
export class CashflowService {
  constructor(
    @InjectModel(CashBalance.name) private readonly balances: Model<CashBalance>,
    @InjectModel(IncomeSource.name) private readonly incomes: Model<IncomeSource>,
    @InjectModel(Expense.name) private readonly expenses: Model<Expense>,
  ) {}

  // ---------------------------------------------------------------- balance

  /** The most recent reconciliation, or a zero balance as of today if none exists yet. */
  async currentBalance(userId: string, today: string): Promise<CashBalanceDto> {
    const latest = await this.balances.findOne({ userId }).sort({ asOf: -1, createdAt: -1 });
    if (latest) return latest.toJSON() as unknown as CashBalanceDto;
    return {
      id: 'none',
      userId,
      amountCents: 0,
      currency: 'USD',
      asOf: today,
      note: 'No balance recorded yet',
      createdAt: today,
      updatedAt: today,
    };
  }

  async setBalance(userId: string, today: string, dto: SetBalanceDto): Promise<CashBalanceDto> {
    const asOf = dto.asOf ? toDay(dto.asOf) : today;
    // One reconciliation per day: re-entering today's figure corrects it rather than
    // stacking two rows with the same `asOf` and an ambiguous winner.
    const saved = await this.balances.findOneAndUpdate(
      { userId, asOf },
      { $set: { amountCents: dto.amountCents, currency: dto.currency ?? 'USD', note: dto.note } },
      { new: true, upsert: true },
    );
    return saved.toJSON() as unknown as CashBalanceDto;
  }

  async balanceHistory(userId: string): Promise<CashBalanceDto[]> {
    const rows = await this.balances.find({ userId }).sort({ asOf: -1 }).limit(60);
    return rows.map((r) => r.toJSON() as unknown as CashBalanceDto);
  }

  // ---------------------------------------------------------------- income

  async listIncomes(userId: string): Promise<IncomeSourceDto[]> {
    const rows = await this.incomes.find({ userId }).sort({ active: -1, amountCents: -1 });
    return rows.map((r) => r.toJSON() as unknown as IncomeSourceDto);
  }

  async createIncome(userId: string, dto: UpsertIncomeDto): Promise<IncomeSourceDto> {
    const created = await this.incomes.create({ ...dto, userId });
    return created.toJSON() as unknown as IncomeSourceDto;
  }

  async updateIncome(userId: string, id: string, dto: UpdateIncomeDto): Promise<IncomeSourceDto> {
    const updated = await this.incomes.findOneAndUpdate({ _id: this.oid(id, 'Income source'), userId }, { $set: dto }, { new: true });
    if (!updated) throw new NotFoundException(`Income source ${id} not found`);
    return updated.toJSON() as unknown as IncomeSourceDto;
  }

  async removeIncome(userId: string, id: string) {
    const deleted = await this.incomes.findOneAndDelete({ _id: this.oid(id, 'Income source'), userId });
    if (!deleted) throw new NotFoundException(`Income source ${id} not found`);
    return { id, deleted: true as const };
  }

  // ---------------------------------------------------------------- expenses

  async listExpenses(userId: string): Promise<ExpenseDto[]> {
    const rows = await this.expenses.find({ userId }).sort({ active: -1, amountCents: -1 });
    return rows.map((r) => r.toJSON() as unknown as ExpenseDto);
  }

  async createExpense(userId: string, dto: UpsertExpenseDto): Promise<ExpenseDto> {
    const created = await this.expenses.create({ ...dto, userId });
    return created.toJSON() as unknown as ExpenseDto;
  }

  async updateExpense(userId: string, id: string, dto: UpdateExpenseDto): Promise<ExpenseDto> {
    const updated = await this.expenses.findOneAndUpdate({ _id: this.oid(id, 'Expense'), userId }, { $set: dto }, { new: true });
    if (!updated) throw new NotFoundException(`Expense ${id} not found`);
    return updated.toJSON() as unknown as ExpenseDto;
  }

  async removeExpense(userId: string, id: string) {
    const deleted = await this.expenses.findOneAndDelete({ _id: this.oid(id, 'Expense'), userId });
    if (!deleted) throw new NotFoundException(`Expense ${id} not found`);
    return { id, deleted: true as const };
  }

  /** Amounts of loan-linked expenses, keyed by expense id — the loan engine's source of truth. */
  async linkedExpenseAmounts(userId: string): Promise<Record<string, number>> {
    const rows = await this.expenses.find({ userId, linkedLoanId: { $exists: true, $ne: null }, active: true });
    return Object.fromEntries(rows.map((r) => [String(r._id), r.amountCents]));
  }

  /** The active loan-repayment expenses for one loan. */
  async expensesForLoan(userId: string, loanId: string): Promise<ExpenseDto[]> {
    const rows = await this.expenses.find({ userId, linkedLoanId: loanId });
    return rows.map((r) => r.toJSON() as unknown as ExpenseDto);
  }

  /**
   * Creates or updates the one-off expense mirroring a personal-life plan. Keeping this in
   * one method is what makes the plan the single owner of the amount (principle IV).
   */
  async syncPersonalPlanExpense(
    userId: string,
    plan: { id: string; title: string; estimatedCostCents?: number; date?: string; currency: string },
  ): Promise<string | undefined> {
    const existing = await this.expenses.findOne({ userId, linkedPersonalPlanId: plan.id });

    if (!plan.estimatedCostCents || !plan.date) {
      if (existing) await existing.deleteOne();
      return undefined;
    }

    const payload = {
      userId,
      label: plan.title,
      amountCents: plan.estimatedCostCents,
      currency: plan.currency,
      category: 'personal',
      kind: 'one_off',
      date: toDay(plan.date),
      active: true,
      linkedPersonalPlanId: plan.id,
      note: 'Kept in sync with a personal-life plan',
    };

    if (existing) {
      await this.expenses.updateOne({ _id: existing._id }, { $set: payload });
      return String(existing._id);
    }
    const created = await this.expenses.create(payload);
    return String(created._id);
  }

  async removePersonalPlanExpense(userId: string, planId: string): Promise<void> {
    await this.expenses.deleteOne({ userId, linkedPersonalPlanId: planId });
  }

  // ---------------------------------------------------------------- projection

  async projection(
    userId: string,
    today: string,
    options?: { to?: string; snapshotDate?: string },
  ): Promise<CashProjection> {
    const [balance, incomes, expenses] = await Promise.all([
      this.currentBalance(userId, today),
      this.listIncomes(userId),
      this.listExpenses(userId),
    ]);

    return projectCash({
      today,
      to: options?.to ? toDay(options.to) : defaultHorizon(today),
      openingBalanceCents: balance.amountCents,
      balanceAsOf: balance.asOf,
      currency: balance.currency as Currency,
      incomes,
      expenses,
      snapshotDate: options?.snapshotDate ? toDay(options.snapshotDate) : today,
    });
  }

  async summary(userId: string, today: string): Promise<CashflowSummary> {
    const projection = await this.projection(userId, today);
    const balance = await this.currentBalance(userId, today);
    const incomes = await this.listIncomes(userId);

    const activeIncome = incomes.filter((i) => i.active);
    const nextDates = activeIncome
      .map((income) => ({ income, date: nextOccurrence(income.recurrence, addDays(today, 1)) }))
      .filter((entry): entry is { income: IncomeSourceDto; date: string } => Boolean(entry.date))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    const next = nextDates[0];

    const freeToday = snapshotAt(projection, today, today);
    // The day after payday is when the month's real spending power is visible.
    const afterIncome = next ? snapshotAt(projection, next.date, today) : freeToday;
    const runway = runwayDays(projection, today);

    return {
      currentBalanceCents: balance.amountCents,
      balanceAsOf: balance.asOf,
      currency: balance.currency as Currency,
      nextIncomeDate: next?.date,
      nextIncomeAmountCents: next?.income.amountCents,
      monthlyNetCents: projection.monthlyNetCents,
      freeTodayCents: freeToday.freeCents,
      freeAfterNextIncomeCents: afterIncome.freeCents,
      runway:
        runway != null
          ? {
              value: runway,
              basis: 'Days until the balance would run dry if no further income arrived.',
              confidence: 'medium',
            }
          : undefined,
    };
  }

  /** Monthly cost of every active recurring expense, for the "where it goes" breakdown. */
  async monthlyBreakdown(userId: string): Promise<{ category: string; monthlyCents: number }[]> {
    const expenses = await this.listExpenses(userId);
    const totals = new Map<string, number>();
    for (const expense of expenses) {
      if (!expense.active || expense.kind !== 'recurring' || !expense.recurrence) continue;
      const monthly = monthlyEquivalentCents(expense.amountCents, expense.recurrence);
      totals.set(expense.category, (totals.get(expense.category) ?? 0) + monthly);
    }
    return [...totals.entries()]
      .map(([category, monthlyCents]) => ({ category, monthlyCents }))
      .sort((a, b) => b.monthlyCents - a.monthlyCents);
  }

  /** Default projection horizon used by the detail page: 12 months out. */
  defaultTo(today: string): string {
    return addMonths(today, 12);
  }

  private oid(id: string, entity: string): string {
    if (!isValidObjectId(id)) throw new NotFoundException(`${entity} ${id} not found`);
    return id;
  }
}
