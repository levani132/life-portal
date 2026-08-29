'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useState } from 'react';
import type { CompletenessGap, Currency, SpendPayment } from '@life-portal/shared-types';
import { formatCents, formatDay } from '@life-portal/shared-domain';
import { AppShell, PageHeader } from '../../components/app-shell';
import {
  Chip,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Modal,
  MoneyInput,
  Panel,
  Select,
  Spinner,
} from '../../components/ui';
import { api } from '../../lib/api';
import { useAction, useApi, useDefaultCurrency } from '../../lib/hooks';

const BANK_LABEL: Record<string, string> = { bog: 'BOG', tbc: 'TBC' };

/**
 * A gap is arithmetic on one Georgian card's own balance line, which the bank prints in lari.
 * `CompletenessGap` carries no currency because there is only ever one it could be in.
 */
const GAP_CURRENCY = 'GEL';

/** Days of history rendered at a time. Older days are one tap away rather than always drawn. */
const DAY_PAGE = 14;

export default function SpendingPage() {
  return (
    <AppShell>
      <Spending />
    </AppShell>
  );
}

function Spending() {
  const payments = useApi<SpendPayment[]>('/spending/payments');
  const gaps = useApi<CompletenessGap[]>('/spending/gaps');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<SpendPayment | null>(null);
  const [visibleDays, setVisibleDays] = useState(DAY_PAGE);

  // Writes here change nothing on the dashboard roots `revalidateLinked` knows about, so each
  // one refetches this page's own two queries.
  const refresh = async () => {
    await Promise.all([payments.mutate(), gaps.mutate()]);
  };

  if (payments.isLoading) return <Spinner label="Reading what was captured…" />;
  if (payments.error) return <ErrorNote message={(payments.error as Error).message} />;
  if (!payments.data) return null;

  const rows = payments.data;
  const queue = rows.filter((payment) => payment.status === 'unparsed');
  const recorded = rows.filter((payment) => payment.status !== 'unparsed');
  const days = groupByDay(recorded);
  const shownDays = days.slice(0, visibleDays);

  return (
    <>
      <PageHeader
        title="Spending"
        subtitle={
          queue.length > 0
            ? `${queue.length} message${queue.length === 1 ? '' : 's'} still waiting to be read`
            : `${recorded.length} payment${recorded.length === 1 ? '' : 's'} captured`
        }
        actions={
          <>
            <Link href="/spending/tokens" className="btn-ghost">
              Capture setup
            </Link>
            <button type="button" className="btn-primary" onClick={() => setAdding(true)}>
              Add a payment
            </button>
          </>
        }
      />

      <div className="space-y-5">
        {queue.length > 0 && (
          <UnparsedQueue
            queue={queue}
            onComplete={(payment) => setEditing(payment)}
            onChanged={refresh}
          />
        )}

        <Completeness gaps={gaps.data} />

        {days.length === 0 ? (
          <Panel title="Payments">
            <EmptyState
              message="Nothing captured yet. Once your phone forwards a bank message it lands here."
              action={
                <Link href="/spending/tokens" className="btn-primary">
                  Set up capture
                </Link>
              }
            />
          </Panel>
        ) : (
          <Panel title="Payments" description="Newest first, grouped by the day the money moved.">
            <div className="space-y-5">
              {shownDays.map(({ day, payments: ofDay }) => (
                <div key={day}>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 border-b border-border pb-1">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
                      {formatDay(day)}
                    </h3>
                    <p className="tabular shrink-0 text-xs text-ink-faint">
                      {capturedThatDay(ofDay)}
                    </p>
                  </div>
                  <ul className="divide-y divide-border">
                    {ofDay.map((payment) => (
                      <PaymentRow
                        key={payment.id}
                        payment={payment}
                        onEdit={() => setEditing(payment)}
                        onChanged={refresh}
                      />
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            {days.length > shownDays.length && (
              <div className="mt-4 flex justify-center">
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => setVisibleDays((current) => current + DAY_PAGE)}
                >
                  Show earlier days
                </button>
              </div>
            )}
          </Panel>
        )}

        <p className="text-xs text-ink-faint">
          Every figure here counts captured payments only. Cash, a message your phone did not
          forward, and anything still in the queue above are not in it — so read these as a lower
          bound on what you spent, never as the whole of it.
        </p>
      </div>

      {adding && <PaymentModal onClose={() => setAdding(false)} onChanged={refresh} />}
      {editing && (
        <PaymentModal existing={editing} onClose={() => setEditing(null)} onChanged={refresh} />
      )}
    </>
  );
}

/**
 * Messages the parser could not read.
 *
 * Deliberately loud and at the top: an unparsed row counts towards no total, so a queue left
 * alone quietly makes every other figure on the page too small.
 */
function UnparsedQueue({
  queue,
  onComplete,
  onChanged,
}: {
  queue: SpendPayment[];
  onComplete: (payment: SpendPayment) => void;
  onChanged: () => Promise<unknown>;
}) {
  return (
    <section className="card border-amber-500/40 bg-amber-500/5 p-5">
      <header className="mb-3">
        <h2 className="text-sm font-semibold text-amber-300">
          {queue.length} message{queue.length === 1 ? '' : 's'} the app could not read
        </h2>
        <p className="mt-0.5 text-xs text-ink-muted">
          Nothing here is counted anywhere yet. Fill in what each one was and it joins your
          spending.
        </p>
      </header>

      <ul className="space-y-3">
        {queue.map((payment) => (
          <QueueRow
            key={payment.id}
            payment={payment}
            onComplete={onComplete}
            onChanged={onChanged}
          />
        ))}
      </ul>
    </section>
  );
}

function QueueRow({
  payment,
  onComplete,
  onChanged,
}: {
  payment: SpendPayment;
  onComplete: (payment: SpendPayment) => void;
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
        <button type="button" className="btn-primary" onClick={() => onComplete(payment)}>
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
 * What the balance line proves is missing (principle VI: an estimate says so).
 *
 * Only one bank prints a balance after each payment, so this can only ever check that one card.
 * The note below says so rather than letting an empty panel read as an all-clear.
 */
function Completeness({ gaps }: { gaps?: CompletenessGap[] }) {
  const found = gaps ?? [];

  return (
    <Panel
      title="Anything missing?"
      description="Checked against the balance one of the banks prints after each payment."
    >
      {found.length === 0 ? (
        <p className="text-xs text-ink-muted">
          Nothing looks missing on the card that reports a balance.
        </p>
      ) : (
        <ul className="space-y-2">
          {found.map((gap, index) => (
            <li
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
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3 text-xs text-ink-faint">
        Only one of the two banks prints a balance, so only that card can be checked this way.
        Silence about the others means unknown, not complete.
      </p>
    </Panel>
  );
}

function PaymentRow({
  payment,
  onEdit,
  onChanged,
}: {
  payment: SpendPayment;
  onEdit: () => void;
  onChanged: () => Promise<unknown>;
}) {
  const { run, pending } = useAction();
  const incoming = payment.direction === 'in';

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
 * Adds a payment by hand, and doubles as the form that completes an unparsed message: giving one
 * an amount is what records it.
 */
function PaymentModal({
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
    cardLast4: '',
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
            ? api.patch(`/spending/payments/${existing.id}`, body)
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

      {!existing && (
        <Field label="Card last four" hint="Lets the missing-message check follow this card.">
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
      )}

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
function timeOf(at: string): string {
  const parsed = new Date(at);
  if (Number.isNaN(parsed.getTime())) return at;
  return parsed.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

/** `YYYY-MM-DDTHH:mm` in local time, which is what `datetime-local` accepts. */
function localInputValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
