'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type {
  Cadence,
  CompletenessGap,
  Currency,
  PeriodSaving,
  SavingsBreakdown,
  SpendAllocation,
  SpendLadder,
  SpendPayment,
} from '@life-portal/shared-types';
import { formatCents, formatDay, localDay } from '@life-portal/shared-domain';
import { AppShell, PageHeader } from '../../components/app-shell';
import { PaymentSheet, type SheetPayment } from '../../components/payment-sheet';
import { SpendLadderView } from '../../components/spend-ladder';
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

const PERIOD_LABEL: Record<Cadence, string> = {
  daily: 'Today',
  weekly: 'This week',
  monthly: 'This month',
  yearly: 'This year',
};

/** Everything the detail page needs in one round trip. */
interface SpendOverview {
  today: string;
  ladder: SpendLadder;
  todayFigures: {
    spentCents: number;
    savedCents: number;
    extraCents: number;
    netCents: number;
  };
  payments: SheetPayment[];
  unparsedCount: number;
  gaps: CompletenessGap[];
  orphans: { paymentId: string; expenseId: string; amountCents: number; forDay: string }[];
  basis: string;
}

interface SavingsView {
  periods: PeriodSaving[];
  cumulative: SavingsBreakdown;
  month: { projectedSavingCents: number; actualSavingCents: number; extraCents: number };
}

export default function SpendingPage() {
  return (
    <AppShell>
      <Spending />
    </AppShell>
  );
}

function Spending() {
  // Which day this is belongs to the spender, not the server: it is resolved on the client after
  // mount, exactly as the food widget does, and sent explicitly.
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => setToday(localDay(new Date())), []);

  const overview = useApi<SpendOverview>(today ? `/spending?today=${today}` : null);
  const savings = useApi<SavingsView>(today ? `/spending/savings?today=${today}` : null);
  const payments = useApi<SpendPayment[]>('/spending/payments');
  const currency = useDefaultCurrency();

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<SpendPayment | null>(null);
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [visibleDays, setVisibleDays] = useState(DAY_PAGE);
  const [reordering, setReordering] = useState(false);
  /**
   * The order a drag is producing, per tier.
   *
   * Held per cadence and merged on commit, because `spendOrder` is one flat list across every
   * tier while a drag only ever rearranges within one of them.
   */
  const [pendingOrder, setPendingOrder] = useState<Record<string, string[]>>({});

  /**
   * Saves the ladder's order.
   *
   * Optimistic in the sense that the drag has already moved the bar — this only persists it, and
   * a refetch afterwards re-derives every projection against the new order, which is the point:
   * reordering re-attributes past days too.
   */
  const saveOrder = async (order: string[]) => {
    await api.put('/spending/order', { order });
    await refresh();
  };

  // Writes here change nothing on the dashboard roots `revalidateLinked` knows about, so each
  // one refetches this page's own queries.
  const refresh = async () => {
    await Promise.all([overview.mutate(), savings.mutate(), payments.mutate()]);
  };

  if (payments.isLoading || !today) return <Spinner label="Reading what was captured…" />;
  if (payments.error) return <ErrorNote message={(payments.error as Error).message} />;
  if (!payments.data) return null;

  const rows = payments.data;
  const queue = rows.filter((payment) => payment.status === 'unparsed');
  const recorded = rows.filter((payment) => payment.status !== 'unparsed');
  const days = groupByDay(recorded);
  const shownDays = days.slice(0, visibleDays);

  // The waterfall only decomposes the recent window, so an older payment is shown without a
  // reading rather than with a made-up one.
  const allocations = new Map<string, SpendAllocation[]>(
    (overview.data?.payments ?? []).map((payment) => [payment.id, payment.allocations ?? []]),
  );
  const orphanIds = new Set((overview.data?.orphans ?? []).map((orphan) => orphan.paymentId));
  const sheetPayment = sheetId
    ? ((overview.data?.payments ?? []).find((payment) => payment.id === sheetId) ??
      rows.find((payment) => payment.id === sheetId))
    : undefined;

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

        {overview.error && <ErrorNote message={(overview.error as Error).message} />}

        {overview.data && (
          <>
            <Figures figures={overview.data.todayFigures} currency={currency} />

            {overview.data.orphans.length > 0 && (
              <Orphans
                orphans={overview.data.orphans}
                currency={currency}
                onOpen={(paymentId) => setSheetId(paymentId)}
              />
            )}

            <SpendLadderView
              ladder={overview.data.ladder}
              currency={currency}
              reorder={{
                editing: reordering,
                onEditingChange: setReordering,
                onOrderChange: (cadence, order) =>
                  setPendingOrder((prev) => ({ ...prev, [cadence]: order })),
                onCommit: (cadence, order) => {
                  const merged = { ...pendingOrder, [cadence]: order };
                  // Tiers are walked in the order the ladder reports them, so the flat list keeps
                  // daily before weekly before monthly — which is also the cascade's order.
                  const flat = (overview.data?.ladder.tiers ?? []).flatMap(
                    (t) => merged[t.cadence] ?? t.rungs.map((r) => r.expenseId),
                  );
                  setPendingOrder(merged);
                  void saveOrder(flat);
                },
              }}
            />
          </>
        )}

        {savings.data && <Savings savings={savings.data} currency={currency} today={today} />}

        <Completeness gaps={overview.data?.gaps} />

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
                        allocations={allocations.get(payment.id)}
                        orphaned={orphanIds.has(payment.id)}
                        currency={currency}
                        onOpen={() => setSheetId(payment.id)}
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
          {overview.data?.basis ??
            'Every figure here counts captured payments only, so read them as a lower bound.'}{' '}
          Cash, a message your phone did not forward, and anything still in the queue above are not
          in it.
        </p>
      </div>

      {adding && <PaymentModal onClose={() => setAdding(false)} onChanged={refresh} />}
      {editing && (
        <PaymentModal existing={editing} onClose={() => setEditing(null)} onChanged={refresh} />
      )}
      {sheetPayment && (
        <PaymentSheet
          // Keyed so switching payments starts a fresh form rather than reusing the last one's.
          key={sheetPayment.id}
          payment={sheetPayment}
          ladder={overview.data?.ladder}
          displayCurrency={currency}
          onClose={() => setSheetId(null)}
          onChanged={refresh}
        />
      )}
    </>
  );
}

/** The four numbers the ladder adds up to, for the periods it is showing. */
function Figures({
  figures,
  currency,
}: {
  figures: SpendOverview['todayFigures'];
  currency: string;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Stat
        label="Used against allowances"
        cents={figures.spentCents}
        currency={currency}
        hint="captured payments only"
      />
      <Stat
        label="Saved"
        cents={figures.savedCents}
        currency={currency}
        tone={figures.savedCents >= 0 ? 'good' : 'bad'}
        hint={figures.savedCents < 0 ? 'you are over budget' : 'allowance left unspent'}
      />
      <Stat
        label="Unplanned"
        cents={figures.extraCents}
        currency={currency}
        tone={figures.extraCents > 0 ? 'warn' : undefined}
        hint="past every allowance, or given its own purpose"
      />
      <Stat
        label="Net"
        cents={figures.netCents}
        currency={currency}
        tone={figures.netCents >= 0 ? 'good' : 'bad'}
        hint="saved, less the unplanned"
      />
    </div>
  );
}

function Stat({
  label,
  cents,
  currency,
  tone,
  hint,
  estimated,
}: {
  label: string;
  cents: number;
  currency: string;
  tone?: 'good' | 'warn' | 'bad';
  hint?: string;
  estimated?: string;
}) {
  return (
    <div className="card p-4">
      <p className="text-xs uppercase tracking-wide text-ink-faint">{label}</p>
      <p
        className={clsx(
          'tabular mt-1 text-xl font-semibold',
          tone === 'good' && 'text-emerald-400',
          tone === 'warn' && 'text-amber-400',
          tone === 'bad' && 'text-rose-400',
        )}
      >
        {formatCents(cents, currency)}
        {estimated && <EstimateMark basis={estimated} />}
      </p>
      {hint && <p className="mt-0.5 text-[11px] text-ink-faint">{hint}</p>}
    </div>
  );
}

/**
 * What each period budgeted, spent and therefore saved.
 *
 * The total does not depend on how the payments were decided — confirming moves attribution, not
 * arithmetic — which is what makes the daily/weekly/monthly split worth showing at all.
 */
function Savings({
  savings,
  currency,
  today,
}: {
  savings: SavingsView;
  currency: string;
  today: string;
}) {
  const order: Cadence[] = ['daily', 'weekly', 'monthly', 'yearly'];
  const current = order
    .map((cadence) =>
      savings.periods.find(
        (period) => period.cadence === cadence && period.from <= today && today <= period.to,
      ),
    )
    .filter((period): period is PeriodSaving => period != null);

  const { cumulative, month } = savings;
  const difference = month.actualSavingCents - month.projectedSavingCents;

  return (
    <Panel
      title="What you have saved"
      description="An allowance you did not spend is money you kept. These are the periods running now."
    >
      {current.length === 0 ? (
        <p className="text-xs text-ink-faint">No period has a budget to save against yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {current.map((period) => (
            <li key={period.cadence} className="flex flex-wrap items-baseline gap-x-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-ink">{PERIOD_LABEL[period.cadence]}</p>
                <p className="tabular text-[11px] text-ink-faint">
                  {formatCents(period.spentCents, currency)} spent of{' '}
                  {formatCents(period.budgetCents, currency)}
                  {period.extraCents > 0 && (
                    <> · {formatCents(period.extraCents, currency)} unplanned</>
                  )}
                </p>
              </div>
              <p
                className={clsx(
                  'tabular shrink-0 text-sm font-medium',
                  period.savingCents >= 0 ? 'text-emerald-400' : 'text-rose-400',
                )}
              >
                {period.savingCents >= 0
                  ? `${formatCents(period.savingCents, currency)} saved`
                  : `${formatCents(Math.abs(period.savingCents), currency)} over`}
              </p>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 rounded-lg border border-border bg-surface p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <p className="text-sm font-medium text-ink">Saved in total</p>
          <p
            className={clsx(
              'tabular shrink-0 text-lg font-semibold',
              cumulative.totalCents >= 0 ? 'text-emerald-400' : 'text-rose-400',
            )}
          >
            {formatCents(cumulative.totalCents, currency)}
          </p>
        </div>
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
          <Split label="from daily" cents={cumulative.daily} currency={currency} />
          <Split label="from weekly" cents={cumulative.weekly} currency={currency} />
          <Split label="from monthly" cents={cumulative.monthly} currency={currency} />
          <Split label="unplanned" cents={cumulative.extraCents} currency={currency} muted />
        </dl>
        <p className="mt-2 text-[11px] text-ink-faint">
          Daily, weekly and monthly add up to the total exactly. Which allowance a saving came from
          moves when you confirm a payment; the total never does.
        </p>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Stat
          label="Month, as planned"
          cents={month.projectedSavingCents}
          currency={currency}
          hint="income less everything budgeted"
          estimated="Projected from your income and planned spending, before any payment was captured."
        />
        <Stat
          label="Month, as it went"
          cents={month.actualSavingCents}
          currency={currency}
          tone={month.actualSavingCents >= 0 ? 'good' : 'bad'}
          hint={
            difference >= 0
              ? `${formatCents(difference, currency)} better than planned`
              : `${formatCents(Math.abs(difference), currency)} short of the plan`
          }
        />
        <Stat
          label="Month's unplanned"
          cents={month.extraCents}
          currency={currency}
          tone={month.extraCents > 0 ? 'warn' : undefined}
          hint="not counted in the saving beside it"
        />
      </div>

      <p className="mt-3 text-xs text-ink-faint">
        Every figure here reflects captured payments only. Anything paid in cash, or in a message
        that never arrived, is missing from the spending — which makes these savings a best case,
        not a measurement.
      </p>
    </Panel>
  );
}

function Split({
  label,
  cents,
  currency,
  muted,
}: {
  label: string;
  cents: number;
  currency: string;
  muted?: boolean;
}) {
  return (
    <div>
      <dt className="text-[11px] text-ink-faint">{label}</dt>
      <dd className={clsx('tabular text-sm', muted ? 'text-amber-400' : 'text-ink')}>
        {formatCents(cents, currency)}
      </dd>
    </div>
  );
}

/**
 * A confirmation whose budget line has since been deleted.
 *
 * It is never dropped and never silently re-guessed: the amount counts as unplanned spending and
 * says so, until the owner decides again.
 */
function Orphans({
  orphans,
  currency,
  onOpen,
}: {
  orphans: SpendOverview['orphans'];
  currency: string;
  onOpen: (paymentId: string) => void;
}) {
  return (
    <section className="card border-amber-500/40 bg-amber-500/5 p-5">
      <header className="mb-3">
        <h2 className="text-sm font-semibold text-amber-300">
          {orphans.length} confirmation{orphans.length === 1 ? '' : 's'} lost their budget line
        </h2>
        <p className="mt-0.5 text-xs text-ink-muted">
          You said where this money went, then the line it named was deleted. It is counting as
          unplanned spending until you say where it goes now.
        </p>
      </header>
      <ul className="space-y-2">
        {orphans.map((orphan, index) => (
          <li
            key={`${orphan.paymentId}-${orphan.forDay}-${index}`}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2"
          >
            <span className="tabular text-xs text-ink-muted">
              {formatCents(orphan.amountCents, currency)} · {formatDay(orphan.forDay)}
            </span>
            <button
              type="button"
              className="btn-ghost shrink-0"
              onClick={() => onOpen(orphan.paymentId)}
            >
              Decide again
            </button>
          </li>
        ))}
      </ul>
    </section>
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
  allocations,
  orphaned,
  currency,
  onOpen,
  onEdit,
  onChanged,
}: {
  payment: SpendPayment;
  allocations?: SpendAllocation[];
  orphaned?: boolean;
  currency: string;
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
          {orphaned && <Chip tone="warn">needs deciding</Chip>}
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
                  `${allocation.label} ${formatCents(allocation.amountCents, currency)}`,
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
