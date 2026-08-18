import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model } from 'mongoose';
import type {
  Currency,
  LoanDetail,
  LoanPayment as LoanPaymentDto,
  Loan as LoanDto,
  LoansSummary,
  RepaymentPlan as RepaymentPlanDto,
} from '@life-portal/shared-types';
import {
  buildLoanScenarios,
  isAfter,
  loanProgressRatio,
  paidCents,
  remainingCents,
  resolveInflows,
} from '@life-portal/shared-domain';
import { CashflowService } from '../cashflow/cashflow.service';
import { ItemsService } from '../items/items.module';
import { SettingsService } from '../settings/settings.module';
import { StocksService } from '../stocks/stocks.service';
import { Loan, LoanPayment, RepaymentPlan } from './loans.schemas';
import type {
  CreateLoanDto,
  CreatePaymentDto,
  CreatePlanDto,
  UpdateLoanDto,
  UpdatePaymentDto,
  UpdatePlanDto,
} from './loans.dto';

@Injectable()
export class LoansService {
  constructor(
    @InjectModel(Loan.name) private readonly loans: Model<Loan>,
    @InjectModel(LoanPayment.name) private readonly payments: Model<LoanPayment>,
    @InjectModel(RepaymentPlan.name) private readonly plans: Model<RepaymentPlan>,
    private readonly cashflow: CashflowService,
    private readonly items: ItemsService,
    private readonly stocks: StocksService,
    private readonly settings: SettingsService,
  ) {}

  // ---------------------------------------------------------------- loans

  async list(userId: string): Promise<LoanDto[]> {
    const rows = await this.loans.find({ userId }).sort({ status: 1, priority: 1, createdAt: 1 });
    return rows.map((r) => r.toJSON() as unknown as LoanDto);
  }

  async create(userId: string, dto: CreateLoanDto): Promise<LoanDto> {
    const created = await this.loans.create({ ...dto, userId });
    return created.toJSON() as unknown as LoanDto;
  }

  async update(userId: string, id: string, dto: UpdateLoanDto): Promise<LoanDto> {
    const updated = await this.loans.findOneAndUpdate(
      { _id: this.oid(id, 'Loan'), userId },
      { $set: dto },
      { new: true, runValidators: true },
    );
    if (!updated) throw new NotFoundException(`Loan ${id} not found`);
    return updated.toJSON() as unknown as LoanDto;
  }

  /** Deleting a loan takes its payments and plans with it, and unlinks its expenses. */
  async remove(userId: string, id: string) {
    const loan = await this.loans.findOneAndDelete({ _id: this.oid(id, 'Loan'), userId });
    if (!loan) throw new NotFoundException(`Loan ${id} not found`);

    await Promise.all([
      this.payments.deleteMany({ userId, loanId: id }),
      this.plans.deleteMany({ userId, loanId: id }),
    ]);

    // Linked expenses survive: the money is still leaving the account, it just no longer
    // repays anything. Silently deleting a budget line would be a nasty surprise.
    for (const expense of await this.cashflow.expensesForLoan(userId, id)) {
      await this.cashflow.updateExpense(userId, expense.id, {
        linkedLoanId: undefined,
        note: 'Loan was deleted; this expense is no longer linked to a debt.',
      } as never);
    }
    return { id, deleted: true as const };
  }

  /** Reorders priorities in one shot, so the UI can drag-and-drop the whole list. */
  async reprioritise(userId: string, order: string[]): Promise<LoanDto[]> {
    await Promise.all(
      order.map((loanId, index) =>
        isValidObjectId(loanId)
          ? this.loans.updateOne({ _id: loanId, userId }, { $set: { priority: index + 1 } })
          : Promise.resolve(),
      ),
    );
    return this.list(userId);
  }

  // ---------------------------------------------------------------- payments

  async listPayments(userId: string, loanId?: string): Promise<LoanPaymentDto[]> {
    const rows = await this.payments
      .find({ userId, ...(loanId ? { loanId } : {}) })
      .sort({ date: -1, createdAt: -1 });
    return rows.map((r) => r.toJSON() as unknown as LoanPaymentDto);
  }

  async addPayment(userId: string, loanId: string, dto: CreatePaymentDto, today: string): Promise<LoanPaymentDto> {
    const loan = await this.loans.findOne({ _id: this.oid(loanId, 'Loan'), userId });
    if (!loan) throw new NotFoundException(`Loan ${loanId} not found`);

    const created = await this.payments.create({
      ...dto,
      userId,
      loanId,
      currency: dto.currency ?? loan.currency,
      date: dto.date ?? today,
    });

    await this.closeIfRepaid(userId, loanId);
    return created.toJSON() as unknown as LoanPaymentDto;
  }

  async updatePayment(userId: string, id: string, dto: UpdatePaymentDto): Promise<LoanPaymentDto> {
    const updated = await this.payments.findOneAndUpdate(
      { _id: this.oid(id, 'Payment'), userId },
      { $set: dto },
      { new: true, runValidators: true },
    );
    if (!updated) throw new NotFoundException(`Payment ${id} not found`);
    await this.closeIfRepaid(userId, updated.loanId);
    return updated.toJSON() as unknown as LoanPaymentDto;
  }

  async removePayment(userId: string, id: string) {
    const deleted = await this.payments.findOneAndDelete({ _id: this.oid(id, 'Payment'), userId });
    if (!deleted) throw new NotFoundException(`Payment ${id} not found`);
    // Deleting a payment can reopen a loan that was marked paid.
    await this.closeIfRepaid(userId, deleted.loanId);
    return { id, deleted: true as const };
  }

  /** Keeps `status` consistent with the folded balance in both directions. */
  private async closeIfRepaid(userId: string, loanId: string): Promise<void> {
    const loan = await this.loans.findOne({ _id: loanId, userId });
    if (!loan || loan.status === 'archived') return;

    const payments = await this.listPayments(userId, loanId);
    const outstanding = remainingCents(loan.toJSON() as unknown as LoanDto, payments);

    if (outstanding === 0 && loan.status !== 'paid') {
      await this.loans.updateOne({ _id: loanId }, { $set: { status: 'paid' } });
    } else if (outstanding > 0 && loan.status === 'paid') {
      await this.loans.updateOne({ _id: loanId }, { $set: { status: 'active' } });
    }
  }

  // ---------------------------------------------------------------- plans

  async listPlans(userId: string, loanId?: string): Promise<RepaymentPlanDto[]> {
    const rows = await this.plans.find({ userId, ...(loanId ? { loanId } : {}) }).sort({ createdAt: 1 });
    return rows.map((r) => r.toJSON() as unknown as RepaymentPlanDto);
  }

  /**
   * Creates a repayment plan and, for recurring plans that ask for it, the matching
   * cash-flow expense.
   *
   * This is the interlink the dashboard is built around: the expense owns the amount, so
   * adjusting the monthly figure in the salary planner immediately changes every loan
   * scenario, and vice versa (constitution principle IV).
   */
  async addPlan(userId: string, loanId: string, dto: CreatePlanDto, today: string): Promise<RepaymentPlanDto> {
    const loan = await this.loans.findOne({ _id: this.oid(loanId, 'Loan'), userId });
    if (!loan) throw new NotFoundException(`Loan ${loanId} not found`);

    if (dto.kind === 'recurring' && !dto.amountCents && !dto.linkedExpenseId) {
      throw new BadRequestException('A recurring plan needs an amount or a linked expense.');
    }
    if (dto.kind === 'one_off' && !dto.date) {
      throw new BadRequestException('A one-off plan needs a date.');
    }

    let linkedExpenseId = dto.linkedExpenseId;
    if (dto.kind === 'recurring' && dto.createLinkedExpense && !linkedExpenseId) {
      const expense = await this.cashflow.createExpense(userId, {
        label: dto.label,
        amountCents: dto.amountCents ?? 0,
        currency: dto.currency ?? loan.currency,
        category: 'loan',
        kind: 'recurring',
        recurrence: {
          cadence: dto.cadence === 'yearly' ? 'yearly' : 'monthly',
          interval: 1,
          dayOfMonth: dto.dayOfMonth ?? 7,
          startDate: dto.startDate ?? today,
          endDate: dto.endDate,
        },
        linkedLoanId: loanId,
        note: `Repayment towards ${loan.lender}`,
      });
      linkedExpenseId = expense.id;
    }

    const { createLinkedExpense: _ignored, ...rest } = dto;
    const created = await this.plans.create({
      ...rest,
      userId,
      loanId,
      linkedExpenseId,
      currency: dto.currency ?? loan.currency,
      // Only salary-funded schedules are guaranteed; asset sales default to speculative.
      guaranteed: dto.guaranteed ?? dto.kind === 'recurring',
    });
    return created.toJSON() as unknown as RepaymentPlanDto;
  }

  /** Updating a plan's amount writes through to the linked expense, keeping one owner. */
  async updatePlan(userId: string, id: string, dto: UpdatePlanDto): Promise<RepaymentPlanDto> {
    const plan = await this.plans.findOne({ _id: this.oid(id, 'Plan'), userId });
    if (!plan) throw new NotFoundException(`Plan ${id} not found`);

    const { createLinkedExpense: _ignored, ...rest } = dto;
    const updated = await this.plans.findOneAndUpdate(
      { _id: id, userId },
      { $set: rest },
      { new: true, runValidators: true },
    );
    // The plan was loaded a moment ago, so this only happens if it was deleted concurrently.
    if (!updated) throw new NotFoundException(`Plan ${id} not found`);

    if (plan.linkedExpenseId && dto.amountCents != null) {
      await this.cashflow.updateExpense(userId, plan.linkedExpenseId, {
        amountCents: dto.amountCents,
      } as never);
    }
    return updated.toJSON() as unknown as RepaymentPlanDto;
  }

  async removePlan(userId: string, id: string, options?: { keepExpense?: boolean }) {
    const deleted = await this.plans.findOneAndDelete({ _id: this.oid(id, 'Plan'), userId });
    if (!deleted) throw new NotFoundException(`Plan ${id} not found`);

    if (deleted.linkedExpenseId && !options?.keepExpense) {
      await this.cashflow.removeExpense(userId, deleted.linkedExpenseId).catch(() => undefined);
    }
    return { id, deleted: true as const };
  }

  // ---------------------------------------------------------------- detail

  /** A loan with its history, its plans resolved against live data, and its scenarios. */
  async detail(userId: string, loanId: string, today: string): Promise<LoanDetail> {
    const loanDoc = await this.loans.findOne({ _id: this.oid(loanId, 'Loan'), userId });
    if (!loanDoc) throw new NotFoundException(`Loan ${loanId} not found`);
    const loan = loanDoc.toJSON() as unknown as LoanDto;

    const settings = await this.settings.get(userId);
    const [payments, plans, linkedExpenseAmounts, itemsProceeds, stocksProceeds] = await Promise.all([
      this.listPayments(userId, loanId),
      this.listPlans(userId, loanId),
      this.cashflow.linkedExpenseAmounts(userId),
      this.items.proceedsForLoan(userId, loanId),
      this.stocks.proceedsForLoan(userId, loanId, today, settings.capitalGainsTaxRate),
    ]);

    const outstanding = remainingCents(loan, payments);
    const scenarioInput = {
      today,
      remainingCents: outstanding,
      currency: loan.currency as Currency,
      interestRate: loan.interestRate,
      plans,
      linkedExpenseAmounts,
      items: itemsProceeds,
      stocks: stocksProceeds,
    };

    const scenarios = buildLoanScenarios(scenarioInput);
    const worst = scenarios.find((s) => s.key === 'worst');

    return {
      loan,
      payments,
      plans,
      paidCents: paidCents(payments),
      remainingCents: outstanding,
      progressRatio: loanProgressRatio(loan, payments),
      inflows: resolveInflows(scenarioInput),
      scenarios,
      // Behind schedule means even the pessimistic plan misses the promise made to the lender.
      behindSchedule: Boolean(
        loan.targetPayoffDate &&
          outstanding > 0 &&
          (!worst?.payoffDate || isAfter(loan.targetPayoffDate, worst.payoffDate)),
      ),
    };
  }

  async summary(userId: string, today: string): Promise<LoansSummary> {
    const loans = await this.list(userId);
    const allPayments = await this.listPayments(userId);

    const paymentsByLoan = new Map<string, LoanPaymentDto[]>();
    for (const payment of allPayments) {
      const bucket = paymentsByLoan.get(payment.loanId);
      if (bucket) bucket.push(payment);
      else paymentsByLoan.set(payment.loanId, [payment]);
    }

    const active = loans.filter((l) => l.status === 'active');
    const settings = await this.settings.get(userId);

    let totalPrincipal = 0;
    let totalPaid = 0;
    let totalRemaining = 0;
    for (const loan of loans) {
      if (loan.status === 'archived') continue;
      const payments = paymentsByLoan.get(loan.id) ?? [];
      totalPrincipal += loan.principalCents;
      totalPaid += paidCents(payments);
      totalRemaining += remainingCents(loan, payments);
    }

    // The dashboard card headlines the highest-priority active debt, with its scenario dates.
    const focusLoan = [...active].sort((a, b) => a.priority - b.priority)[0];
    let focus: LoansSummary['focus'];
    if (focusLoan) {
      const payments = paymentsByLoan.get(focusLoan.id) ?? [];
      const [linkedExpenseAmounts, itemsProceeds, stocksProceeds, plans] = await Promise.all([
        this.cashflow.linkedExpenseAmounts(userId),
        this.items.proceedsForLoan(userId, focusLoan.id),
        this.stocks.proceedsForLoan(userId, focusLoan.id, today, settings.capitalGainsTaxRate),
        this.listPlans(userId, focusLoan.id),
      ]);

      const scenarios = buildLoanScenarios({
        today,
        remainingCents: remainingCents(focusLoan, payments),
        currency: focusLoan.currency as Currency,
        interestRate: focusLoan.interestRate,
        plans,
        linkedExpenseAmounts,
        items: itemsProceeds,
        stocks: stocksProceeds,
      });

      focus = {
        loanId: focusLoan.id,
        lender: focusLoan.lender,
        remainingCents: remainingCents(focusLoan, payments),
        progressRatio: loanProgressRatio(focusLoan, payments),
        bestCasePayoffDate: scenarios.find((s) => s.key === 'best')?.payoffDate,
        worstCasePayoffDate: scenarios.find((s) => s.key === 'worst')?.payoffDate,
      };
    }

    return {
      totalPrincipalCents: totalPrincipal,
      totalPaidCents: totalPaid,
      totalRemainingCents: totalRemaining,
      currency: (settings.displayCurrency ?? 'USD') as Currency,
      activeCount: active.length,
      focus,
    };
  }

  /** Every loan with its full detail, for the widget's index page. */
  async listWithDetail(userId: string, today: string): Promise<LoanDetail[]> {
    const loans = await this.list(userId);
    const details: LoanDetail[] = [];
    for (const loan of loans) {
      details.push(await this.detail(userId, loan.id, today));
    }
    return details;
  }

  /** Records the proceeds of a sold item against the loan it was earmarked for. */
  async recordItemSale(
    userId: string,
    loanId: string,
    itemId: string,
    amountCents: number,
    today: string,
  ): Promise<LoanPaymentDto> {
    return this.addPayment(
      userId,
      loanId,
      { amountCents, source: 'item_sale', sourceRefId: itemId, date: today },
      today,
    );
  }

  private oid(id: string, entity: string): string {
    if (!isValidObjectId(id)) throw new NotFoundException(`${entity} ${id} not found`);
    return id;
  }
}
