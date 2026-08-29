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
  RealisedSale,
} from '@life-portal/shared-types';
import {
  addDays,
  addMonths,
  defaultHorizon,
  fxContext,
  monthlyEquivalentCents,
  nextOccurrence,
  projectCash,
  realisedSales,
  runwayDays,
  snapshotAt,
  toDay,
  toDisplayCents,
} from '@life-portal/shared-domain';
import { ItemsService } from '../items/items.module';
import { StocksService } from '../stocks/stocks.service';
import { FxService } from '../fx/fx.module';
import { SettingsService } from '../settings/settings.module';
import { SpendPayment } from '../spending/spending.schemas';
import { CashBalance, Expense, IncomeSource } from './cashflow.schemas';
import type {
  SetBalanceDto,
  UpdateExpenseDto,
  UpdateIncomeDto,
  UpsertExpenseDto,
  UpsertIncomeDto,
} from './cashflow.dto';

@Injectable()
export class CashflowService {
  constructor(
    @InjectModel(CashBalance.name) private readonly balances: Model<CashBalance>,
    @InjectModel(IncomeSource.name) private readonly incomes: Model<IncomeSource>,
    @InjectModel(Expense.name) private readonly expenses: Model<Expense>,
    @InjectModel(SpendPayment.name) private readonly spendPayments: Model<SpendPayment>,
    private readonly items: ItemsService,
    private readonly stocks: StocksService,
    private readonly settings: SettingsService,
    private readonly fx: FxService,
  ) {}

  /**
   * The currency to render in, and the rates to get there.
   *
   * Every figure this service returns goes through here. Rows keep the currency they were
   * recorded in — a USD salary stays a USD salary — and only the presentation is unified.
   */
  private display(userId: string, today: string) {
    return this.fx.displayFor(userId, today);
  }

  /**
   * What was really spent by card on each past day, in the display currency.
   *
   * Read straight off the `spend_payments` collection rather than through `SpendingService`,
   * which is the one deliberate exception to going through the owning module's service:
   * `SpendingModule` already imports this module to read the budget, so the reverse import
   * would be a cycle. A scoped read of another widget's rows is the same trade `realisedSales()`
   * already makes with items and lots. See `docs/DECISIONS.md`.
   *
   * Only days with at least one captured payment appear — the projection treats an absent day
   * as "nothing captured, keep the budget", never as "nothing spent". Each payment converts at
   * the rate in force on its own day, and money the owner marked as paid back is not spending.
   */
  private async actualOutByDay(
    userId: string,
    displayCurrency: Currency,
  ): Promise<Record<string, number>> {
    const rows = await this.spendPayments.find({
      userId,
      direction: 'out',
      status: 'recorded',
    });
    if (!rows.length) return {};

    const archive = await this.fx.archive();
    const byDay: Record<string, number> = {};
    for (const row of rows) {
      const spendable = row.amountCents - (row.notReallySpentCents ?? 0);
      if (spendable <= 0) continue;
      const fx = fxContext(archive, row.day, displayCurrency);
      byDay[row.day] =
        (byDay[row.day] ?? 0) + toDisplayCents(spendable, row.currency as Currency, fx).cents;
    }
    return byDay;
  }

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
    const updated = await this.incomes.findOneAndUpdate(
      { _id: this.oid(id, 'Income source'), userId },
      { $set: dto },
      { new: true },
    );
    if (!updated) throw new NotFoundException(`Income source ${id} not found`);
    return updated.toJSON() as unknown as IncomeSourceDto;
  }

  async removeIncome(userId: string, id: string) {
    const deleted = await this.incomes.findOneAndDelete({
      _id: this.oid(id, 'Income source'),
      userId,
    });
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
    const updated = await this.expenses.findOneAndUpdate(
      { _id: this.oid(id, 'Expense'), userId },
      { $set: dto },
      { new: true },
    );
    if (!updated) throw new NotFoundException(`Expense ${id} not found`);
    return updated.toJSON() as unknown as ExpenseDto;
  }

  /**
   * Records that the owner refused a budget proposal for this line.
   *
   * Lives here rather than in the spending module because cash flow owns the expenses
   * collection and nothing else may write it (principle IV). It is deliberately *not* part of
   * `UpdateExpenseDto`: a dismissal is a decision about a proposal, not an editable property of
   * the budget, and exposing it on the PATCH route would let one arrive bundled with an amount
   * change — which is exactly the pair that must not be settable together.
   */
  async recordSuggestionDismissal(
    userId: string,
    id: string,
    at: string,
    cents: number,
  ): Promise<ExpenseDto> {
    const updated = await this.expenses.findOneAndUpdate(
      { _id: this.oid(id, 'Expense'), userId },
      { $set: { suggestionDismissedAt: at, suggestionDismissedCents: cents } },
      { new: true },
    );
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
    const rows = await this.expenses.find({
      userId,
      linkedLoanId: { $exists: true, $ne: null },
      active: true,
    });
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
    plan: {
      id: string;
      title: string;
      estimatedCostCents?: number;
      date?: string;
      currency: string;
    },
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

  // ---------------------------------------------------------------- sales

  /**
   * Cash from things already sold, across items and share lots. Derived on read from the rows
   * that own the amounts (constitution principles III and IV) — selling something is recorded
   * once, on the item or the lot, and shows up here without a second write.
   */
  async sales(userId: string): Promise<RealisedSale[]> {
    const [items, lots] = await Promise.all([
      this.items.list(userId),
      this.stocks.listLots(userId),
    ]);
    return realisedSales({ items, lots });
  }

  // ---------------------------------------------------------------- projection

  async projection(
    userId: string,
    today: string,
    options?: { to?: string; snapshotDate?: string },
  ): Promise<CashProjection> {
    const [balance, incomes, expenses, sales] = await Promise.all([
      this.currentBalance(userId, today),
      this.listIncomes(userId),
      this.listExpenses(userId),
      this.sales(userId),
    ]);

    const display = await this.display(userId, today);
    const actualOutByDay = await this.actualOutByDay(userId, display.currency);

    return projectCash({
      actualOutByDay,
      today,
      to: options?.to ? toDay(options.to) : defaultHorizon(today),
      openingBalanceCents: balance.amountCents,
      balanceAsOf: balance.asOf,
      // The projection reports in the *display* currency; the reconciliation keeps its own.
      currency: display.currency,
      openingCurrency: balance.currency as Currency,
      fx: display.fx,
      incomes,
      expenses,
      sales,
      snapshotDate: options?.snapshotDate ? toDay(options.snapshotDate) : today,
    });
  }

  async summary(userId: string, today: string): Promise<CashflowSummary> {
    const projection = await this.projection(userId, today);
    const balance = await this.currentBalance(userId, today);
    const incomes = await this.listIncomes(userId);
    const display = await this.display(userId, today);

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
      // What is in the account *today*, not what was in it when the user last checked. The
      // reconciliation is the anchor; everything since is already in the projection.
      currentBalanceCents: freeToday.projectedBalanceCents,
      reconciledBalanceCents: toDisplayCents(
        balance.amountCents,
        balance.currency as Currency,
        display.fx,
      ).cents,
      balanceAsOf: balance.asOf,
      currency: display.currency,
      nextIncomeDate: next?.date,
      nextIncomeAmountCents: next
        ? toDisplayCents(next.income.amountCents, next.income.currency, display.fx).cents
        : undefined,
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
