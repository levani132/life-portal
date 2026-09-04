'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useState } from 'react';
import type {
  CompletenessGap,
  Currency,
  SpendAllocation,
  SpendPayment,
  WidgetTone,
} from '@life-portal/shared-types';
import { formatCents, formatDay } from '@life-portal/shared-domain';
import { api } from '../lib/api';
import { useAction, useApi, useDefaultCurrency } from '../lib/hooks';
import type { SheetPayment } from './payment-sheet';
import {
  Chip,
  EmptyState,
  ErrorNote,
  EstimateMark,
  Field,
  Input,
  Modal,
  MoneyInput,
  Panel,
  Select,
  Spinner,
} from './ui';

const BANK_LABEL: Record<string, string> = { bog: 'BOG', tbc: 'TBC' };

/**
 * A gap is arithmetic on one Georgian card's own balance line, which the bank prints in lari.
 * `CompletenessGap` carries no currency because there is only ever one it could be in.
 */
const GAP_CURRENCY = 'GEL';

/** Days of history rendered at a time in the full list. Older days are one tap away. */
const DAY_PAGE = 14;

/** How many recent payments the compact panel shows before "See all" takes over. */
const COMPACT_COUNT = 6;

/** A confirmation whose budget line has since been deleted. Shown, never dropped. */
export interface OrphanedAllocation {
  paymentId: string;
  expenseId: string;
  amountCents: number;
  forDay: string;
}

/** What the owner has said about a payment, or that nothing has been said yet. */
export function decisionChip(payment: SpendPayment): { label: string; tone: WidgetTone } | null {
  if (payment.direction === 'in' || payment.status === 'unparsed') return null;
  if (payment.decision?.kind === 'confirmed') return { label: 'confirmed', tone: 'good' };
  if (payment.decision?.kind === 'custom') return { label: 'custom', tone: 'neutral' };
  return { label: 'projected', tone: 'neutral' };
}

/**
 * The compact captured-payments panel: the last few payments, a way to add one by hand, and the
 * full history behind "See all". Amounts are always in the payment's own currency — the display
 * currency never touches a captured amount.
 */
export function PaymentsPanel({
  payments,
  displayCurrency,
  onOpen,
  onChanged,
}: {
  /** The overview's recent window, allocations included. Newest first. */
  payments?: SheetPayment[];
  displayCurrency: string;
  /** Opens the payment sheet, where a payment stops being a guess. */
  onOpen: (payment: SheetPayment) => void;
  onChanged: () => Promise<unknown>;
}) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<SpendPayment | null>(null);
  const [seeingAll, setSeeingAll] = useState(false);

  const recorded = (payments ?? []).filter((payment) => payment.status === 'recorded');
  const recent = recorded.slice(0, COMPACT_COUNT);

  return (
    <Panel
      title="Payments"
      description="What the banks' messages captured, newest first."
      actions={
        <>
          <button type="button" className="btn-ghost" onClick={() => setAdding(true)}>
            + Add one
          </button>
          <button type="button" className="btn-ghost" onClick={() => setSeeingAll(true)}>
            See all
          </button>
        </>
      }
    >
      {recent.length === 0 ? (
        <EmptyState
          message="Nothing captured yet. Once your phone forwards a bank message it lands here."
          action={
            <Link href="/spending/tokens" className="btn-primary">
              Set up capture
            </Link>
          }
        />
      ) : (
        <ul className="divide-y divide-border">
          {recent.map((payment) => {
            const chip = decisionChip(payment);
            return (
              <li key={payment.id}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 py-2 text-left"
                  onClick={() => onOpen(payment)}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm">{payment.merchant ?? 'No merchant given'}</p>
                      {payment.direction === 'in' && <Chip tone="good">money in</Chip>}
                      {chip && <Chip tone={chip.tone}>{chip.label}</Chip>}
                    </div>
                    <p className="mt-0.5 text-xs text-ink-faint">
                      {formatDay(payment.day)} ·{' '}
                      {payment.source === 'sms'
                        ? `${payment.bank ? `${BANK_LABEL[payment.bank] ?? payment.bank} ` : ''}message`
                        : 'by hand'}
                    </p>
                  </div>
                  <span
                    className={clsx(
                      'tabular shrink-0 text-sm font-medium',
                      payment.direction === 'in' ? 'text-emerald-400' : 'text-ink',
                    )}
                  >
                    {payment.direction === 'in' ? '+' : ''}
                    {formatCents(payment.amountCents, payment.currency)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {adding && <PaymentModal onClose={() => setAdding(false)} onChanged={onChanged} />}
      {seeingAll && (
        <AllPaymentsModal
          overviewPayments={payments}
          displayCurrency={displayCurrency}
          onClose={() => setSeeingAll(false)}
          onOpen={onOpen}
          onEdit={(payment) => setEditing(payment)}
          onChanged={onChanged}
        />
      )}
      {/* After the full list in the tree: both are fixed at the same z-index, so the later
          sibling paints on top — the edit form opened from that list must cover it. */}
      {editing && (
        <PaymentModal existing={editing} onClose={() => setEditing(null)} onChanged={onChanged} />
      )}
    </Panel>
  );
}

/** The full capture history, grouped by day and paged, behind "See all". */
function AllPaymentsModal({
  overviewPayments,
  displayCurrency,
  onClose,
  onOpen,
  onEdit,
  onChanged,
}: {
  overviewPayments?: SheetPayment[];
  displayCurrency: string;
  onClose: () => void;
  onOpen: (payment: SheetPayment) => void;
  onEdit: (payment: SpendPayment) => void;
  onChanged: () => Promise<unknown>;
}) {
  const all = useApi<SpendPayment[]>('/spending/payments');
  const [visibleDays, setVisibleDays] = useState(DAY_PAGE);

  // The waterfall only decomposes the recent window, so an older payment is shown without a
  // reading rather than with a made-up one.
  const allocations = new Map<string, SpendAllocation[]>(
    (overviewPayments ?? []).map((payment) => [payment.id, payment.allocations ?? []]),
  );

  const rows = all.data ?? [];
  const recorded = rows.filter((payment) => payment.status !== 'unparsed');
  const days = groupByDay(recorded);
  const shownDays = days.slice(0, visibleDays);

  return (
    <Modal open wide onClose={onClose} title="Every payment">
      {all.isLoading && <Spinner label="Reading what was captured…" />}
      {all.error && <ErrorNote message={(all.error as Error).message} />}

      {all.data && days.length === 0 && (
        <EmptyState message="Nothing captured yet. Once your phone forwards a bank message it lands here." />
      )}

      {days.length > 0 && (
        <div className="space-y-5">
          {shownDays.map(({ day, payments: ofDay }) => (
            <div key={day}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 border-b border-border pb-1">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
                  {formatDay(day)}
                </h3>
                <p className="tabular shrink-0 text-xs text-ink-faint">{capturedThatDay(ofDay)}</p>
              </div>
              <ul className="divide-y divide-border">
                {ofDay.map((payment) => (
                  <PaymentRow
                    key={payment.id}
                    payment={payment}
                    allocations={allocations.get(payment.id)}
                    displayCurrency={displayCurrency}
                    onOpen={() => onOpen({ ...payment, allocations: allocations.get(payment.id) })}
                    onEdit={() => onEdit(payment)}
                    onChanged={onChanged}
                  />
                ))}
              </ul>
            </div>
          ))}

          {days.length > shownDays.length && (
            <div className="flex justify-center">
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setVisibleDays((current) => current + DAY_PAGE)}
              >
                Show earlier days
              </button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function PaymentRow({
  payment,
  allocations,
  displayCurrency,
  onOpen,
  onEdit,
  onChanged,
}: {
  payment: SpendPayment;
  allocations?: SpendAllocation[];
  displayCurrency: string;
  onOpen: () => void;
  onEdit: () => void;
  onChanged: () => Promise<unknown>;
}) {
  const { run, pending } = useAction();
  const incoming = payment.direction === 'in';
  const decided = payment.decision != null;

  const meta = [
    timeOf(payment.at),
    payment.cardLast4 ? `card ••${payment.cardLast4}` : null,
  ].filter(Boolean);

  return (
    <li className="flex items-start justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-medium">{payment.merchant ?? 'No merchant given'}</p>
          {incoming && <Chip tone="good">money in</Chip>}
          <Chip>
            {payment.source === 'sms'
              ? `${payment.bank ? `${BANK_LABEL[payment.bank] ?? payment.bank} ` : ''}message`
              : 'by hand'}
          </Chip>
        </div>
        <p className="mt-0.5 text-xs text-ink-faint">{meta.join(' · ')}</p>

        {!incoming && allocations && allocations.length > 0 && (
          <button
            type="button"
            className="mt-1 block max-w-full truncate text-left text-xs text-ink-muted hover:text-ink"
            onClick={onOpen}
          >
            {allocations
              .map(
                (allocation) =>
                  `${allocation.label} ${formatCents(allocation.amountCents, displayCurrency)}`,
              )
              .join(' · ')}
            {allocations.some((allocation) => allocation.projected) ? (
              <EstimateMark basis="Where the app thinks it went. Nothing has been confirmed." />
            ) : null}
          </button>
        )}
      </div>

      <div className="shrink-0 text-right">
        <p
          className={clsx(
            'tabular text-sm font-medium',
            incoming ? 'text-emerald-400' : 'text-ink',
          )}
        >
          {incoming ? '+' : ''}
          {formatCents(payment.amountCents, payment.currency)}
        </p>
        {payment.notReallySpentCents != null && payment.notReallySpentCents > 0 && (
          <p className="tabular text-[11px] text-ink-faint">
            {formatCents(payment.notReallySpentCents, payment.currency)} paid back
          </p>
        )}
        <div className="mt-1 flex justify-end gap-2">
          {!incoming && payment.status !== 'unparsed' && (
            <button
              type="button"
              className={clsx(
                'text-[11px]',
                decided ? 'text-ink-faint hover:text-ink' : 'text-sky-400 hover:text-sky-300',
              )}
              onClick={onOpen}
            >
              {decided ? 'decided' : 'what was this?'}
            </button>
          )}
          <button
            type="button"
            className="text-[11px] text-ink-faint hover:text-ink"
            onClick={onEdit}
          >
            edit
          </button>
          <button
            type="button"
            className="text-[11px] text-ink-faint hover:text-rose-400"
            disabled={pending}
            onClick={() =>
              void run(async () => {
                await api.delete(`/spending/payments/${payment.id}`);
                await onChanged();
              })
            }
          >
            ✕
          </button>
        </div>
      </div>
    </li>
  );
}

/**
 * "Anything missing?" — everything that might make the captured figures too small, in one quiet
 * panel: messages the parser could not read, gaps the one balance-printing card can prove, and
 * confirmations whose budget line has since been deleted. When nothing is wrong it collapses to
 * a single line.
 */
export function MissingPanel({
  unparsedCount,
  gaps,
  orphans,
  displayCurrency,
  onOpenPaymentId,
  onChanged,
}: {
  unparsedCount?: number;
  gaps?: CompletenessGap[];
  orphans?: OrphanedAllocation[];
  displayCurrency: string;
  onOpenPaymentId: (paymentId: string) => void;
  onChanged: () => Promise<unknown>;
}) {
  const [fixing, setFixing] = useState(false);
  const queueCount = unparsedCount ?? 0;
  const foundGaps = gaps ?? [];
  const foundOrphans = orphans ?? [];
  const allClear = queueCount === 0 && foundGaps.length === 0 && foundOrphans.length === 0;

  return (
    <Panel
      title="Anything missing?"
      actions={
        <Link href="/spending/tokens" className="btn-ghost text-xs">
          Set up message capture
        </Link>
      }
    >
      {allClear ? (
        <p className="text-xs text-ink-muted">
          Every message was read, and nothing looks missing on the card that reports a balance.
        </p>
      ) : (
        <div className="space-y-2">
          {queueCount > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2">
              <p className="text-xs text-amber-200">
                {queueCount} message{queueCount === 1 ? '' : 's'} the app could not read. They count
                towards no figure until you fill them in.
              </p>
              <button type="button" className="btn-ghost shrink-0" onClick={() => setFixing(true)}>
                Fix {queueCount === 1 ? 'it' : 'them'}
              </button>
            </div>
          )}

          {foundGaps.map((gap, index) => (
            <p
              key={`${gap.cardLast4}-${gap.from}-${gap.to}-${index}`}
              className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-200"
            >
              {gap.missingCents > 0 ? (
                <>
                  A message may be missing — about{' '}
                  <span className="tabular">{formatCents(gap.missingCents, GAP_CURRENCY)}</span>{' '}
                  left card ••{gap.cardLast4} between {formatDay(gap.from)} and {formatDay(gap.to)}{' '}
                  with nothing captured for it.
                </>
              ) : (
                <>
                  A message may have been counted twice — about{' '}
                  <span className="tabular">
                    {formatCents(Math.abs(gap.missingCents), GAP_CURRENCY)}
                  </span>{' '}
                  more was captured on card ••{gap.cardLast4} between {formatDay(gap.from)} and{' '}
                  {formatDay(gap.to)} than the card's balance moved by.
                </>
              )}
            </p>
          ))}

          {foundOrphans.map((orphan, index) => (
            <div
              key={`${orphan.paymentId}-${orphan.forDay}-${index}`}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2"
            >
              <p className="text-xs text-amber-200">
                A confirmation lost its budget line —{' '}
                <span className="tabular">{formatCents(orphan.amountCents, displayCurrency)}</span>{' '}
                on {formatDay(orphan.forDay)} counts as unplanned until you decide again.
              </p>
              <button
                type="button"
                className="btn-ghost shrink-0"
                onClick={() => onOpenPaymentId(orphan.paymentId)}
              >
                Decide again
              </button>
            </div>
          ))}
        </div>
      )}

      <p className="mt-3 text-xs text-ink-faint">
        Only one of the two banks prints a balance, so only that card can be checked for gaps.
        Silence about the others means unknown, not complete.
      </p>

      {fixing && (
        <UnparsedModal
          onClose={() => setFixing(false)}
          onChanged={async () => {
            await onChanged();
          }}
        />
      )}
    </Panel>
  );
}

/**
 * Messages the parser could not read, each waiting to be completed or dismissed.
 *
 * An unparsed row counts towards no total, so a queue left alone quietly makes every other
 * figure on the page too small — which is why this flow exists at all.
 */
function UnparsedModal({
  onClose,
  onChanged,
}: {
  onClose: () => void;
  onChanged: () => Promise<unknown>;
}) {
  const queue = useApi<SpendPayment[]>('/spending/payments?status=unparsed');
  const [completing, setCompleting] = useState<SpendPayment | null>(null);

  const refresh = async () => {
    await Promise.all([queue.mutate(), onChanged()]);
  };

  return (
    <Modal open wide onClose={onClose} title="Messages the app could not read">
      {queue.isLoading && <Spinner label="Fetching the queue…" />}
      {queue.error && <ErrorNote message={(queue.error as Error).message} />}
      {queue.data && queue.data.length === 0 && (
        <p className="text-xs text-ink-muted">The queue is empty — everything has been read.</p>
      )}

      {(queue.data ?? []).length > 0 && (
        <ul className="space-y-3">
          {(queue.data ?? []).map((payment) => (
            <UnparsedRow
              key={payment.id}
              payment={payment}
              onComplete={() => setCompleting(payment)}
              onChanged={refresh}
            />
          ))}
        </ul>
      )}

      {completing && (
        <PaymentModal
          existing={completing}
          onClose={() => setCompleting(null)}
          onChanged={refresh}
        />
      )}
    </Modal>
  );
}

function UnparsedRow({
  payment,
  onComplete,
  onChanged,
}: {
  payment: SpendPayment;
  onComplete: () => void;
  onChanged: () => Promise<unknown>;
}) {
  const { run, pending } = useAction();

  return (
    <li className="rounded-lg border border-border bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone="warn">unread</Chip>
        {payment.bank && <Chip>{BANK_LABEL[payment.bank] ?? payment.bank}</Chip>}
        <span className="text-xs text-ink-faint">
          {formatDay(payment.day)} · {timeOf(payment.at)}
        </span>
      </div>

      <p className="mt-2 whitespace-pre-wrap break-words text-xs text-ink-muted">
        {payment.raw ?? 'The message text was not kept.'}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className="btn-primary" onClick={onComplete}>
          Fill it in
        </button>
        <button
          type="button"
          className="btn-ghost"
          disabled={pending}
          onClick={() =>
            void run(async () => {
              await api.delete(`/spending/payments/${payment.id}`);
              await onChanged();
            })
          }
        >
          Not a payment
        </button>
      </div>
    </li>
  );
}

/**
 * Adds a payment by hand, and doubles as the form that completes an unparsed message: giving one
 * an amount is what records it.
 */
export function PaymentModal({
  existing,
  onClose,
  onChanged,
}: {
  existing?: SpendPayment;
  onClose: () => void;
  onChanged: () => Promise<unknown>;
}) {
  const defaultCurrency = useDefaultCurrency();
  const completing = existing?.status === 'unparsed';
  const [form, setForm] = useState({
    // An unparsed row stores 0 until the owner says otherwise; showing that as an amount would
    // invite them to leave it.
    amountCents: existing && !completing ? existing.amountCents : undefined,
    currency: existing?.currency as Currency | undefined,
    merchant: existing?.merchant ?? '',
    cardLast4: existing?.cardLast4 ?? '',
    direction: existing?.direction ?? 'out',
    at: localInputValue(existing ? new Date(existing.at) : new Date()),
    notReallySpentCents: existing?.notReallySpentCents,
  });
  const { run, pending, error } = useAction();
  const currency = form.currency ?? defaultCurrency;

  return (
    <Modal
      open
      onClose={onClose}
      title={completing ? 'What was this message?' : existing ? 'Edit payment' : 'Add a payment'}
      submitLabel={completing ? 'Record it' : existing ? 'Save' : 'Add payment'}
      pending={pending}
      error={error}
      onSubmit={async () => {
        const body = {
          amountCents: form.amountCents,
          currency,
          merchant: form.merchant || undefined,
          direction: form.direction,
          // Sent as an instant; the server decides which day it belongs to from the profile's
          // day-start hour, exactly as it does for an ingested message.
          at: new Date(form.at).toISOString(),
          notReallySpentCents: form.notReallySpentCents,
        };
        const ok = await run(async () => {
          await (existing
            ? // On PATCH an empty card field is sent as '' — "no card" — so clearing it works.
              api.patch(`/spending/payments/${existing.id}`, {
                ...body,
                cardLast4: form.cardLast4,
              })
            : api.post('/spending/payments', {
                ...body,
                cardLast4: form.cardLast4 || undefined,
              }));
          await onChanged();
        });
        if (ok) onClose();
      }}
    >
      {completing && (
        <p className="whitespace-pre-wrap break-words rounded-lg border border-border bg-surface px-3 py-2 text-xs text-ink-muted">
          {existing?.raw ?? 'The message text was not kept.'}
        </p>
      )}

      <Field label="How much">
        <MoneyInput
          required
          valueCents={form.amountCents}
          onChangeCents={(cents) => setForm({ ...form, amountCents: cents })}
          currency={currency}
          onChangeCurrency={(next) => setForm({ ...form, currency: next })}
        />
      </Field>

      <Field label="Who to" hint="Recorded so you recognise it. Nothing reads it.">
        <Input
          placeholder="Carrefour"
          value={form.merchant}
          onChange={(event) => setForm({ ...form, merchant: event.target.value })}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Direction">
          <Select
            value={form.direction}
            onChange={(event) =>
              setForm({ ...form, direction: event.target.value as SpendPayment['direction'] })
            }
          >
            <option value="out">Money out</option>
            <option value="in">Money in</option>
          </Select>
        </Field>
        <Field label="When">
          <Input
            type="datetime-local"
            value={form.at}
            onChange={(event) => setForm({ ...form, at: event.target.value })}
          />
        </Field>
      </div>

      {/* Shown for existing rows too: a manual entry that named no card is invisible to the
          missing-message check, and this is where the owner fixes that after the fact. */}
      <Field
        label="Card last four"
        hint="Lets the missing-message check follow this card, and counts the payment against its balance."
      >
        <Input
          inputMode="numeric"
          maxLength={4}
          placeholder="4821"
          value={form.cardLast4}
          onChange={(event) =>
            setForm({ ...form, cardLast4: event.target.value.replace(/\D/g, '') })
          }
        />
      </Field>

      <Field label="Paid back" hint="A share someone returned, or a refund. Leave blank if none.">
        <MoneyInput
          valueCents={form.notReallySpentCents}
          onChangeCents={(cents) => setForm({ ...form, notReallySpentCents: cents })}
          currency={currency}
        />
      </Field>
    </Modal>
  );
}

/** Groups an already-newest-first list into days, keeping that order. */
function groupByDay(payments: SpendPayment[]): { day: string; payments: SpendPayment[] }[] {
  const days: { day: string; payments: SpendPayment[] }[] = [];
  for (const payment of payments) {
    const last = days[days.length - 1];
    if (last && last.day === payment.day) last.payments.push(payment);
    else days.push({ day: payment.day, payments: [payment] });
  }
  return days;
}

/**
 * A day's money out, per currency.
 *
 * Currencies are listed side by side rather than added up: without a rate for the day, one total
 * would be a made-up number (see `docs/modules/fx.md`).
 */
function capturedThatDay(payments: SpendPayment[]): string {
  const totals = new Map<string, number>();
  for (const payment of payments) {
    if (payment.direction === 'in') continue;
    totals.set(payment.currency, (totals.get(payment.currency) ?? 0) + payment.amountCents);
  }
  if (totals.size === 0) return '';
  return `${[...totals].map(([currency, cents]) => formatCents(cents, currency)).join(' · ')} captured`;
}

/** The wall-clock time of a payment, in the reader's zone — which is the phone's. */
export function timeOf(at: string): string {
  const parsed = new Date(at);
  if (Number.isNaN(parsed.getTime())) return at;
  return parsed.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

/** `YYYY-MM-DDTHH:mm` in local time, which is what `datetime-local` accepts. */
function localInputValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
