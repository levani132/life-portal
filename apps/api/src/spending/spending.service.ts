import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, isValidObjectId } from 'mongoose';
import type {
  CompletenessGap,
  SpendBank,
  SpendPayment as SpendPaymentDto,
} from '@life-portal/shared-types';
import {
  detectMissedMessages,
  localDay,
  parseBankMessage,
  toDay,
} from '@life-portal/shared-domain';
import { CashflowService } from '../cashflow/cashflow.service';
import { NutritionService } from '../nutrition/nutrition.service';
import { SpendPayment } from './spending.schemas';
import type {
  CreatePaymentDto,
  IngestDto,
  PromotePurposeDto,
  SetDecisionDto,
  UpdatePaymentDto,
} from './spending.dto';

/**
 * How close two identical messages must be to count as the same one.
 *
 * A content hash alone would be wrong here, and the owner's own data shows why: a BOG message
 * carries **no time**, so two ₾4.00 coffees at the same shop on the same day are byte-identical.
 * Discarding the second would under-report spending — precisely the failure this feature exists
 * to prevent. A retried automation fires seconds apart; a real second coffee does not.
 */
const DUPLICATE_WINDOW_MS = 120_000;

@Injectable()
export class SpendingService {
  constructor(
    @InjectModel(SpendPayment.name) private readonly payments: Model<SpendPayment>,
    private readonly cashflow: CashflowService,
    private readonly nutrition: NutritionService,
  ) {}

  /** Every read funnels through here, so the owner clause can never be omitted. */
  private scoped(userId: string, extra: Record<string, unknown> = {}) {
    return { userId, ...extra };
  }

  /**
   * Which day a payment belongs to.
   *
   * Unlike meals — where the browser decides and sends `?today=` — the server applies the rule
   * here, because a phone automation cannot read the owner's profile. It can only report the
   * moment; `dayStartHour` lives on the server, so this is the only place the two can meet.
   */
  private async dayFor(userId: string, at: string): Promise<string> {
    const profile = await this.nutrition.profile(userId);
    return localDay(new Date(at), profile.dayStartHour ?? 4);
  }

  // ---------------------------------------------------------------- ingest

  /**
   * Records a submitted bank message.
   *
   * Answers success even when the message cannot be read. A Shortcut has no way to handle an
   * error, so any non-2xx means the message is gone for good — an unreadable one is therefore
   * stored verbatim and queued rather than rejected.
   */
  async ingest(
    userId: string,
    dto: IngestDto,
    receivedAt: string,
  ): Promise<{
    recorded: boolean;
    duplicate: boolean;
    status: string;
    paymentId?: string;
    day?: string;
  }> {
    const at = dto.at ?? receivedAt;

    const duplicate = await this.findRecentDuplicate(userId, dto.raw, receivedAt);
    if (duplicate) {
      return {
        recorded: false,
        duplicate: true,
        status: duplicate.status,
        paymentId: duplicate.id,
        day: duplicate.day,
      };
    }

    const parsed = parseBankMessage(dto.raw, dto.bank as SpendBank | undefined);
    const day = await this.dayFor(userId, parsed?.statedAt ?? at);

    const created = await this.payments.create({
      userId,
      // An unparsed row keeps its text and nothing else; it counts towards no figure until the
      // owner completes it, which is safer than recording a guessed amount.
      amountCents: parsed?.amountCents ?? 0,
      currency: parsed?.currency ?? 'GEL',
      merchant: parsed?.merchant,
      cardLast4: parsed?.cardLast4,
      at: parsed?.statedAt ?? at,
      day,
      direction: parsed?.direction ?? 'out',
      source: dto.source ?? 'sms',
      bank: dto.bank,
      raw: dto.raw,
      rawReceivedAt: receivedAt,
      status: parsed && parsed.amountCents != null ? 'recorded' : 'unparsed',
      reportedBalanceCents: parsed?.reportedBalanceCents,
      cashbackCents: parsed?.cashbackCents,
    });

    const row = created.toJSON() as unknown as SpendPaymentDto;
    return {
      recorded: true,
      duplicate: false,
      status: row.status,
      paymentId: row.id,
      day: row.day,
    };
  }

  /**
   * The same text arriving twice within the window is one payment.
   *
   * Compared on the raw text *and* the arrival time, never on content alone — see
   * `DUPLICATE_WINDOW_MS`.
   */
  private async findRecentDuplicate(
    userId: string,
    raw: string,
    receivedAt: string,
  ): Promise<SpendPaymentDto | null> {
    const since = new Date(new Date(receivedAt).getTime() - DUPLICATE_WINDOW_MS).toISOString();
    const found = await this.payments
      .findOne(this.scoped(userId, { raw, rawReceivedAt: { $gte: since } }))
      .sort({ rawReceivedAt: -1 });
    return found ? (found.toJSON() as unknown as SpendPaymentDto) : null;
  }

  // ---------------------------------------------------------------- payments

  async list(
    userId: string,
    from?: string,
    to?: string,
    status?: string,
  ): Promise<SpendPaymentDto[]> {
    const filter: Record<string, unknown> = {};
    if (from || to) {
      filter['day'] = {
        ...(from ? { $gte: toDay(from) } : {}),
        ...(to ? { $lte: toDay(to) } : {}),
      };
    }
    if (status) filter['status'] = status;
    const rows = await this.payments.find(this.scoped(userId, filter)).sort({ at: -1 });
    return rows.map((r) => r.toJSON() as unknown as SpendPaymentDto);
  }

  async create(userId: string, today: string, dto: CreatePaymentDto): Promise<SpendPaymentDto> {
    const at = dto.at ?? new Date().toISOString();
    const day = dto.day ? toDay(dto.day) : await this.dayFor(userId, at);
    this.assertNotOverRefunded(dto.amountCents, dto.notReallySpentCents);
    const created = await this.payments.create({
      ...dto,
      userId,
      at,
      day,
      currency: dto.currency ?? 'GEL',
      source: 'manual',
      status: 'recorded',
    });
    return created.toJSON() as unknown as SpendPaymentDto;
  }

  /** Also how an `unparsed` row is completed: supplying an amount records it. */
  async update(userId: string, id: string, dto: UpdatePaymentDto): Promise<SpendPaymentDto> {
    const existing = await this.byId(userId, id);
    const amountCents = dto.amountCents ?? existing.amountCents;
    this.assertNotOverRefunded(
      amountCents,
      dto.notReallySpentCents ?? existing.notReallySpentCents,
    );

    const patch: Record<string, unknown> = { ...dto };
    if (dto.day) patch['day'] = toDay(dto.day);
    if (dto.amountCents != null && existing.status === 'unparsed') patch['status'] = 'recorded';

    const updated = await this.payments.findOneAndUpdate(
      this.scoped(userId, { _id: id }),
      { $set: patch },
      { new: true },
    );
    if (!updated) throw new NotFoundException(`Payment ${id} not found`);
    return updated.toJSON() as unknown as SpendPaymentDto;
  }

  async remove(userId: string, id: string): Promise<void> {
    const deleted = await this.payments.findOneAndDelete(this.scoped(userId, { _id: id }));
    if (!deleted) throw new NotFoundException(`Payment ${id} not found`);
  }

  /**
   * Records what a payment was really for.
   *
   * A confirmation may cover only part of the payment — the remainder rejoins the cascade — but
   * never more than it, which would let one payment consume more allowance than money left the
   * account.
   */
  async setDecision(
    userId: string,
    id: string,
    today: string,
    dto: SetDecisionDto,
  ): Promise<SpendPaymentDto> {
    const existing = await this.byId(userId, id);

    if (dto.kind === 'none') {
      const cleared = await this.payments.findOneAndUpdate(
        this.scoped(userId, { _id: id }),
        { $unset: { decision: '' } },
        { new: true },
      );
      return (cleared as NonNullable<typeof cleared>).toJSON() as unknown as SpendPaymentDto;
    }

    if (dto.kind === 'custom') {
      if (!dto.purpose?.trim())
        throw new BadRequestException('A custom purpose needs a description');
      return this.writeDecision(userId, id, {
        kind: 'custom',
        purpose: dto.purpose.trim(),
        decidedAt: today,
      });
    }

    const allocations = dto.allocations ?? [];
    if (!allocations.length)
      throw new BadRequestException('A confirmation needs at least one allocation');

    const spendable = existing.amountCents - (existing.notReallySpentCents ?? 0);
    const claimed = allocations.reduce((sum, a) => sum + a.amountCents, 0);
    if (claimed > spendable) {
      throw new BadRequestException(
        `Allocations come to more than the payment: ${claimed} against ${spendable}`,
      );
    }
    for (const allocation of allocations) {
      if (allocation.throughDay && allocation.forDay && allocation.throughDay < allocation.forDay) {
        throw new BadRequestException('A span cannot end before it starts');
      }
      await this.assertOwnsExpense(userId, allocation.expenseId);
    }

    return this.writeDecision(userId, id, { kind: 'confirmed', allocations, decidedAt: today });
  }

  /** Turns a custom purpose into a budgeted line — created through cashflow, which owns it. */
  async promote(userId: string, id: string, today: string, dto: PromotePurposeDto) {
    const existing = await this.byId(userId, id);
    if (existing.decision?.kind !== 'custom') {
      throw new BadRequestException('Only a payment with a custom purpose can be promoted');
    }

    const expense = await this.cashflow.createExpense(userId, {
      label: dto.label,
      amountCents: dto.amountCents,
      currency: dto.currency ?? existing.currency,
      category: 'other',
      kind: 'recurring',
      recurrence: { cadence: dto.cadence, interval: 1, startDate: today },
    } as never);

    await this.payments.updateOne(this.scoped(userId, { _id: id }), {
      $set: { 'decision.promotedToExpenseId': (expense as { id: string }).id },
    });
    return expense;
  }

  // ---------------------------------------------------------------- completeness

  /**
   * Messages the app can prove it never received.
   *
   * Derived rather than stored, so a payment added by hand later closes its own gap.
   */
  async gaps(userId: string): Promise<CompletenessGap[]> {
    return detectMissedMessages(await this.list(userId));
  }

  // ---------------------------------------------------------------- helpers

  private async byId(userId: string, id: string): Promise<SpendPaymentDto> {
    if (!isValidObjectId(id)) throw new NotFoundException(`Payment ${id} not found`);
    const found = await this.payments.findOne(this.scoped(userId, { _id: id }));
    if (!found) throw new NotFoundException(`Payment ${id} not found`);
    return found.toJSON() as unknown as SpendPaymentDto;
  }

  private async writeDecision(
    userId: string,
    id: string,
    decision: unknown,
  ): Promise<SpendPaymentDto> {
    const updated = await this.payments.findOneAndUpdate(
      this.scoped(userId, { _id: id }),
      { $set: { decision } },
      { new: true },
    );
    if (!updated) throw new NotFoundException(`Payment ${id} not found`);
    return updated.toJSON() as unknown as SpendPaymentDto;
  }

  private assertNotOverRefunded(amountCents: number, notReallySpentCents?: number): void {
    if (notReallySpentCents != null && notReallySpentCents > amountCents) {
      throw new BadRequestException('More cannot be paid back than was spent');
    }
  }

  /** A confirmation may only name a line the same owner holds. */
  private async assertOwnsExpense(userId: string, expenseId: string): Promise<void> {
    const expenses = await this.cashflow.listExpenses(userId);
    if (!expenses.some((e) => e.id === expenseId)) {
      throw new NotFoundException(`Budget line ${expenseId} not found`);
    }
  }
}
