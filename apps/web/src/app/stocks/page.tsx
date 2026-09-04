'use client';

import clsx from 'clsx';
import { useState } from 'react';
import type {
  EsppPlan,
  EsppProjection,
  Loan,
  StockLot,
  StockPosition,
  StockTarget,
  StocksSummary,
  SuggestedTarget,
} from '@life-portal/shared-types';
import { formatCents, formatDay, formatPct } from '@life-portal/shared-domain';
import { AppShell, PageHeader } from '../../components/app-shell';
import {
  Chip,
  EmptyState,
  ErrorNote,
  EstimateMark,
  Field,
  Input,
  Modal,
  Money,
  MoneyInput,
  Panel,
  Select,
  Spinner,
} from '../../components/ui';
import { api } from '../../lib/api';
import { useAction, useApi } from '../../lib/hooks';

interface StocksOverview {
  today: string;
  positions: StockPosition[];
  summary: StocksSummary;
  espp: EsppProjection[];
  esppPlans: EsppPlan[];
  targets: StockTarget[];
  provider: { name: string; live: boolean; unavailableReason?: string };
}

export default function StocksPage() {
  return (
    <AppShell>
      <Stocks />
    </AppShell>
  );
}

function Stocks() {
  const { data, error, isLoading } = useApi<StocksOverview>('/stocks');
  const { data: loansData } = useApi<{ loans: { loan: Loan }[] }>('/loans');
  const [addingLot, setAddingLot] = useState(false);
  const [quoting, setQuoting] = useState<string | null>(null);
  const { run, pending } = useAction();

  if (isLoading) return <Spinner />;
  if (error) return <ErrorNote message={(error as Error).message} />;
  if (!data) return null;

  const { summary } = data;
  const loans = (loansData?.loans ?? []).map((entry) => entry.loan);

  return (
    <>
      <PageHeader
        title="Stocks"
        subtitle={
          summary.quotesFetchedAt
            ? `Prices from ${formatDay(summary.quotesFetchedAt)} · ${data.provider.live ? 'Finnhub' : 'entered by hand'}`
            : 'No prices yet'
        }
        actions={
          <>
            {data.provider.live && (
              <button
                type="button"
                className="btn-ghost"
                disabled={pending}
                onClick={() => void run(() => api.post('/stocks/refresh'))}
              >
                {pending ? 'Refreshing…' : 'Refresh prices'}
              </button>
            )}
            <button type="button" className="btn-primary" onClick={() => setAddingLot(true)}>
              Add a purchase
            </button>
          </>
        }
      />

      {!data.provider.live && data.provider.unavailableReason && (
        <div className="mb-5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          {data.provider.unavailableReason} Everything still works — use “set price” on each
          holding.
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Tile label="Paid in total" value={formatCents(summary.totalCostCents, summary.currency)} />
        <Tile
          label="Worth now"
          value={
            summary.totalMarketValueCents != null
              ? formatCents(summary.totalMarketValueCents, summary.currency)
              : 'no prices'
          }
          tone={
            summary.totalUnrealisedPnlCents == null
              ? undefined
              : summary.totalUnrealisedPnlCents >= 0
                ? 'good'
                : 'bad'
          }
          hint={
            summary.totalUnrealisedPnlPct != null
              ? `${formatPct(summary.totalUnrealisedPnlPct)} on cost`
              : undefined
          }
        />
        <Tile
          label="If all hit target"
          value={formatCents(summary.totalValueAtTargetCents, summary.currency)}
          estimated
          hint="uses your target, or the suggestion"
        />
        <Tile
          label="Towards debts at target"
          value={formatCents(summary.liquidationAtTargetCents, summary.currency)}
          estimated
          hint="after tax and earmarking"
        />
      </div>

      <div className="space-y-5">
        {data.positions.length === 0 ? (
          <EmptyState
            message="No holdings yet."
            action={
              <button type="button" className="btn-primary" onClick={() => setAddingLot(true)}>
                Add a purchase
              </button>
            }
          />
        ) : (
          data.positions.map((position) => (
            <PositionPanel
              key={position.symbol}
              position={position}
              loans={loans}
              today={data.today}
              onSetPrice={() => setQuoting(position.symbol)}
            />
          ))
        )}

        {data.espp.length > 0 && <EsppPanel projections={data.espp} plans={data.esppPlans} />}
      </div>

      <LotModal open={addingLot} onClose={() => setAddingLot(false)} today={data.today} loans={loans} />
      {quoting && <QuoteModal symbol={quoting} onClose={() => setQuoting(null)} />}
    </>
  );
}

function Tile({
  label,
  value,
  hint,
  tone,
  estimated,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'good' | 'bad';
  estimated?: boolean;
}) {
  return (
    <div className="card p-4">
      <p className="text-xs uppercase tracking-wide text-ink-faint">{label}</p>
      <p
        className={clsx(
          'tabular mt-1 text-xl font-semibold',
          tone === 'good' && 'text-emerald-400',
          tone === 'bad' && 'text-rose-400',
        )}
      >
        {value}
        {estimated && <EstimateMark basis="Depends on target prices, which are estimates." />}
      </p>
      {hint && <p className="mt-0.5 text-[11px] text-ink-faint">{hint}</p>}
    </div>
  );
}

function PositionPanel({
  position,
  loans,
  today,
  onSetPrice,
}: {
  position: StockPosition;
  loans: Loan[];
  today: string;
  onSetPrice: () => void;
}) {
  const [showTarget, setShowTarget] = useState(false);
  const [showMaths, setShowMaths] = useState(false);
  const [selling, setSelling] = useState<StockLot | null>(null);
  const { run, pending } = useAction();
  const currency = position.currency;

  return (
    <div className="card">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border p-5">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold">{position.symbol}</h2>
            <span className="text-sm text-ink-muted">
              {position.quantity.toFixed(4).replace(/\.?0+$/, '')} shares
            </span>
            {position.quoteStale && <Chip tone="warn">price is stale</Chip>}
            {position.effectiveTargetIsSuggested && <Chip>using the suggested target</Chip>}
          </div>
          <p className="mt-1 text-xs text-ink-faint">
            average cost {formatCents(position.averageCostPerShareCents, currency)} · paid{' '}
            {formatCents(position.totalCostCents, currency)}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn-ghost"
            disabled={pending}
            onClick={() => void run(() => api.post(`/stocks/refresh-fundamentals/${position.symbol}`))}
          >
            Refresh fundamentals
          </button>
          <button type="button" className="btn-ghost" onClick={onSetPrice}>
            Set price
          </button>
          <button type="button" className="btn-primary" onClick={() => setShowTarget(true)}>
            Set target
          </button>
        </div>
      </div>

      <div className="grid gap-4 p-5 sm:grid-cols-4">
        <Metric
          label="Price now"
          value={
            position.currentPricePerShareCents != null
              ? formatCents(position.currentPricePerShareCents, currency)
              : '—'
          }
        />
        <Metric
          label="Worth now"
          value={position.marketValueCents != null ? formatCents(position.marketValueCents, currency) : '—'}
          tone={
            position.unrealisedPnlCents == null ? undefined : position.unrealisedPnlCents >= 0 ? 'good' : 'bad'
          }
          hint={position.unrealisedPnlPct != null ? formatPct(position.unrealisedPnlPct) : undefined}
        />
        <Metric
          label="Target price"
          value={
            position.effectiveTargetPerShareCents != null
              ? formatCents(position.effectiveTargetPerShareCents, currency)
              : 'not set'
          }
          hint={position.effectiveTargetIsSuggested ? 'suggested' : 'yours'}
        />
        <Metric
          label="Worth at target"
          value={
            position.valueAtTargetCents != null ? formatCents(position.valueAtTargetCents, currency) : '—'
          }
        />
      </div>

      {position.suggestedTarget && (
        <div className="border-t border-border px-5 py-4">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 text-left"
            onClick={() => setShowMaths(!showMaths)}
          >
            <div>
              <p className="text-sm">
                Suggested target{' '}
                <span className="font-semibold">
                  {formatCents(position.suggestedTarget.value, currency)}
                </span>
                <span
                  className={clsx(
                    'ml-2 text-xs',
                    position.suggestedTarget.upsidePct >= 0 ? 'text-emerald-400' : 'text-rose-400',
                  )}
                >
                  {formatPct(position.suggestedTarget.upsidePct)} from here
                </span>
                <Chip tone={position.suggestedTarget.confidence === 'high' ? 'good' : 'neutral'}>
                  {position.suggestedTarget.confidence} confidence
                </Chip>
              </p>
              <p className="mt-0.5 text-xs text-ink-faint">
                over {position.suggestedTarget.horizonMonths} months · tap to see the maths
              </p>
            </div>
            <span className="text-xs text-ink-faint">{showMaths ? '▲' : '▼'}</span>
          </button>

          {showMaths && <TargetMaths suggestion={position.suggestedTarget} currency={currency} />}
        </div>
      )}

      <div className="border-t border-border p-5">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-faint">
          Purchases ({position.lots.length})
        </p>
        <ul className="divide-y divide-border">
          {position.lots.map((lot) => {
            const earmarked = loans.find((loan) => loan.id === lot.allocateToLoanId);
            const remaining = lot.quantity - (lot.soldQuantity ?? 0);
            return (
              <li key={lot.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <div className="min-w-0">
                  <span className="text-ink-muted">{formatDay(lot.purchaseDate)}</span>
                  <span className="ml-2">
                    {lot.quantity.toFixed(4).replace(/\.?0+$/, '')} @{' '}
                    {formatCents(lot.pricePerShareCents, currency)}
                  </span>
                  {lot.source === 'espp' && <Chip tone="good">ESPP</Chip>}
                  {lot.source === 'rsu' && <Chip>RSU</Chip>}
                  {remaining === 0 && <Chip>sold</Chip>}
                  {earmarked && <Chip tone="warn">→ {earmarked.lender}</Chip>}
                </div>
                <div className="flex items-center gap-3">
                  <Money cents={Math.round(remaining * lot.pricePerShareCents)} currency={currency} />
                  {remaining > 0 && (
                    <button
                      type="button"
                      className="text-[11px] text-sky-400 hover:text-sky-300"
                      onClick={() => setSelling(lot)}
                    >
                      sell
                    </button>
                  )}
                  <button
                    type="button"
                    className="text-[11px] text-ink-faint hover:text-rose-400"
                    disabled={pending}
                    onClick={() => void run(() => api.delete(`/stocks/lots/${lot.id}`))}
                  >
                    ✕
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {showTarget && (
        <TargetModal
          symbol={position.symbol}
          currency={currency}
          existing={position.target}
          suggested={position.suggestedTarget?.value}
          onClose={() => setShowTarget(false)}
        />
      )}
      {selling && (
        <SellLotModal
          lot={selling}
          currency={currency}
          currentPriceCents={position.currentPricePerShareCents}
          loans={loans}
          today={today}
          onClose={() => setSelling(null)}
        />
      )}
    </div>
  );
}

/**
 * Records a sale — part of a lot or all of it — and decides where the money goes in the same
 * breath: all to the balance, all earmarked to a loan, or split. The earmarked share is excluded
 * from the cash-flow inflow (the loans widget's money, counted there); the rest lands as
 * spendable cash on the sale day.
 */
function SellLotModal({
  lot,
  currency,
  currentPriceCents,
  loans,
  today,
  onClose,
}: {
  lot: StockLot;
  currency: string;
  currentPriceCents?: number;
  loans: Loan[];
  today: string;
  onClose: () => void;
}) {
  const remaining = lot.quantity - (lot.soldQuantity ?? 0);
  const [form, setForm] = useState({
    quantity: String(remaining),
    priceCents: currentPriceCents as number | undefined,
    soldAt: today,
    /** '' means the balance; otherwise a loan id. */
    destination: lot.allocateToLoanId ?? '',
    /** Blank means "all of it" when a loan is picked. */
    toLoanCents: undefined as number | undefined,
  });
  const { run, pending, error } = useAction();
  const [notice, setNotice] = useState<string | null>(null);

  const quantity = Number(form.quantity);
  const grossCents =
    Number.isFinite(quantity) && quantity > 0 && form.priceCents != null
      ? Math.round(quantity * form.priceCents)
      : undefined;
  const loanShareCents =
    grossCents != null ? Math.min(grossCents, form.toLoanCents ?? grossCents) : undefined;

  return (
    <Modal
      open
      onClose={onClose}
      title={`Sell ${lot.symbol}`}
      submitLabel="Record the sale"
      pending={pending}
      error={error ?? notice}
      onSubmit={async () => {
        setNotice(null);
        if (!Number.isFinite(quantity) || quantity <= 0 || quantity > remaining) {
          setNotice(`Between more than nothing and ${remaining} shares.`);
          return;
        }
        if (form.priceCents == null || form.priceCents <= 0) {
          setNotice('The sale price has to be more than nothing.');
          return;
        }
        const ratio =
          form.destination && grossCents
            ? Math.min(1, Math.max(0, (loanShareCents ?? grossCents) / grossCents))
            : undefined;
        const ok = await run(() =>
          api.post(`/stocks/lots/${lot.id}/sell`, {
            quantity,
            pricePerShareCents: form.priceCents,
            soldAt: form.soldAt,
            // '' explicitly routes everything to the balance, clearing an old earmark.
            allocateToLoanId: form.destination,
            allocationRatio: ratio,
          }),
        );
        if (ok) onClose();
      }}
    >
      <p className="text-xs text-ink-muted">
        This lot has {remaining} share{remaining === 1 ? '' : 's'} left, bought at{' '}
        {formatCents(lot.pricePerShareCents, currency)}. The sale shows up as cash on the day it
        happened.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="How many shares" hint="Fractions are fine.">
          <Input
            type="number"
            step="0.0001"
            min="0"
            max={String(remaining)}
            required
            value={form.quantity}
            onChange={(e) => setForm({ ...form, quantity: e.target.value })}
          />
        </Field>
        <Field label="Sold on">
          <Input
            type="date"
            required
            value={form.soldAt}
            onChange={(e) => setForm({ ...form, soldAt: e.target.value })}
          />
        </Field>
      </div>
      <Field label="Price per share" hint="What the broker actually filled at.">
        <MoneyInput
          required
          valueCents={form.priceCents}
          onChangeCents={(cents) => setForm({ ...form, priceCents: cents })}
          currency={currency}
        />
      </Field>
      <Field label="Where the money goes">
        <Select
          value={form.destination}
          onChange={(e) => setForm({ ...form, destination: e.target.value, toLoanCents: undefined })}
        >
          <option value="">My balance</option>
          {loans.map((loan) => (
            <option key={loan.id} value={loan.id}>
              Towards {loan.lender}
            </option>
          ))}
        </Select>
      </Field>
      {form.destination && (
        <Field
          label="How much of it goes to the loan"
          hint="Leave blank for all of it. Anything less lands on your balance."
        >
          <MoneyInput
            valueCents={form.toLoanCents}
            onChangeCents={(cents) => setForm({ ...form, toLoanCents: cents })}
            currency={currency}
          />
        </Field>
      )}
      {grossCents != null && (
        <p className="tabular text-xs text-ink-faint">
          Sells for {formatCents(grossCents, currency)}
          {form.destination && loanShareCents != null ? (
            <>
              {' '}
              — {formatCents(loanShareCents, currency)} earmarked for the loan,{' '}
              {formatCents(grossCents - loanShareCents, currency)} to your balance.
            </>
          ) : (
            <> — all of it to your balance.</>
          )}
        </p>
      )}
      {form.destination && (
        <p className="text-xs text-ink-faint">
          Earmarking sets the money aside for the debt — record the actual repayment on the Debts
          screen when you send it.
        </p>
      )}
    </Modal>
  );
}

function Metric({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'good' | 'bad';
}) {
  return (
    <div>
      <p className="text-xs text-ink-faint">{label}</p>
      <p
        className={clsx(
          'tabular mt-0.5 text-base font-semibold',
          tone === 'good' && 'text-emerald-400',
          tone === 'bad' && 'text-rose-400',
        )}
      >
        {value}
      </p>
      {hint && <p className="text-[11px] text-ink-faint">{hint}</p>}
    </div>
  );
}

/**
 * Shows every weighted term behind the suggestion. The constitution requires an estimate to
 * carry its reasoning, and for a number that could drive a sell decision that means the full
 * breakdown rather than a tooltip.
 */
function TargetMaths({ suggestion, currency }: { suggestion: SuggestedTarget; currency: string }) {
  return (
    <div className="mt-4 space-y-3">
      <ul className="space-y-2">
        {suggestion.components.map((component) => (
          <li key={component.key} className="rounded-lg border border-border px-3 py-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm">{component.label}</span>
              <span className="tabular text-sm">
                {formatCents(component.valueCents, currency)}
                <span className="ml-2 text-xs text-ink-faint">
                  × {Math.round(component.weight * 100)}%
                </span>
              </span>
            </div>
            <p className="mt-1 text-xs text-ink-faint">{component.basis}</p>
          </li>
        ))}
      </ul>

      <p className="text-xs text-ink-faint">
        Kept between {formatCents(suggestion.floorCents, currency)} and{' '}
        {formatCents(suggestion.capCents, currency)} so a bad data point cannot produce a silly
        number. {suggestion.basis}
      </p>
    </div>
  );
}

function EsppPanel({ projections, plans }: { projections: EsppProjection[]; plans: EsppPlan[] }) {
  return (
    <Panel
      title="EPAM share plan"
      description="Twice a year, at a discount to the lower of the two boundary prices."
    >
      {projections.map((projection) => {
        const plan = plans.find((entry) => entry.symbol === projection.symbol);
        return (
          <div key={projection.symbol} className="space-y-3">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Metric
                label="Shares expected"
                value={projection.totalEstimatedShares.toFixed(2)}
                hint={`by ${formatDay(projection.through)}`}
              />
              <Metric
                label="You will contribute"
                value={formatCents(projection.totalContributionCents, plan?.currency ?? 'USD')}
              />
              <Metric
                label="Worth at target"
                value={formatCents(projection.valueAtTargetCents, plan?.currency ?? 'USD')}
              />
              <Metric
                label="Discount"
                value={plan ? `${Math.round(plan.discountPct * 100)}%` : '—'}
              />
            </div>

            <ul className="divide-y divide-border">
              {projection.grants.map((grant) => (
                <li key={grant.purchaseDate} className="py-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm">
                        {formatDay(grant.purchaseDate)}
                        {grant.modelled && (
                          <EstimateMark basis="Both boundary prices are unknown, so the current price stands in." />
                        )}
                      </p>
                      <p className="text-xs text-ink-faint">{grant.basis}</p>
                    </div>
                    <div className="text-right text-sm">
                      <p className="tabular">
                        {grant.estimatedShares.toFixed(3)} shares @{' '}
                        {formatCents(grant.purchasePriceCents, plan?.currency ?? 'USD')}
                      </p>
                      <p className="text-[11px] text-emerald-400">
                        +{formatCents(grant.discountValueCents, plan?.currency ?? 'USD')} from the
                        discount
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            <ul className="space-y-1">
              {projection.assumptions.map((line, index) => (
                <li key={index} className="text-xs text-ink-faint">
                  • {line}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </Panel>
  );
}

// ------------------------------------------------------------------ modals

function LotModal({
  open,
  onClose,
  today,
  loans,
}: {
  open: boolean;
  onClose: () => void;
  today: string;
  loans: Loan[];
}) {
  const [form, setForm] = useState({
    symbol: '',
    quantity: '',
    pricePerShareCents: undefined as number | undefined,
    purchaseDate: today,
    source: 'purchase',
    allocateToLoanId: '',
  });
  const { run, pending, error } = useAction();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a purchase"
      submitLabel="Add purchase"
      pending={pending}
      error={error}
      onSubmit={async () => {
        const ok = await run(() =>
          api.post('/stocks/lots', {
            symbol: form.symbol.toUpperCase(),
            quantity: Number(form.quantity),
            pricePerShareCents: form.pricePerShareCents ?? 0,
            purchaseDate: form.purchaseDate,
            source: form.source,
            allocateToLoanId: form.allocateToLoanId || undefined,
          }),
        );
        if (ok) onClose();
      }}
    >
      <p className="text-xs text-ink-muted">
        Each purchase is recorded separately, so buying the same share twice keeps both prices.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Symbol">
          <Input
            required
            placeholder="EPAM"
            value={form.symbol}
            onChange={(e) => setForm({ ...form, symbol: e.target.value.toUpperCase() })}
          />
        </Field>
        <Field label="How many shares" hint="Fractions are fine.">
          <Input
            type="number"
            step="0.0001"
            min="0"
            required
            value={form.quantity}
            onChange={(e) => setForm({ ...form, quantity: e.target.value })}
          />
        </Field>
      </div>
      <Field label="Price paid per share" hint="After any discount.">
        <MoneyInput
          required
          valueCents={form.pricePerShareCents}
          onChangeCents={(cents) => setForm({ ...form, pricePerShareCents: cents })}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Bought on">
          <Input
            type="date"
            required
            value={form.purchaseDate}
            onChange={(e) => setForm({ ...form, purchaseDate: e.target.value })}
          />
        </Field>
        <Field label="Where from">
          <Select value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}>
            <option value="purchase">Bought myself</option>
            <option value="espp">EPAM share plan</option>
            <option value="rsu">Granted (RSU)</option>
          </Select>
        </Field>
      </div>
      <Field label="Earmark proceeds for">
        <Select
          value={form.allocateToLoanId}
          onChange={(e) => setForm({ ...form, allocateToLoanId: e.target.value })}
        >
          <option value="">Nothing in particular</option>
          {loans.map((loan) => (
            <option key={loan.id} value={loan.id}>
              {loan.lender}
            </option>
          ))}
        </Select>
      </Field>
    </Modal>
  );
}

function TargetModal({
  symbol,
  currency,
  existing,
  suggested,
  onClose,
}: {
  symbol: string;
  currency: string;
  existing?: StockTarget;
  suggested?: number;
  onClose: () => void;
}) {
  const [targetPriceCents, setTargetPriceCents] = useState<number | undefined>(
    existing?.targetPriceCents ?? suggested,
  );
  const [horizonMonths, setHorizonMonths] = useState(String(existing?.horizonMonths ?? 12));
  const [rationale, setRationale] = useState(existing?.rationale ?? '');
  const { run, pending, error } = useAction();

  return (
    <Modal
      open
      onClose={onClose}
      title={`Target price for ${symbol}`}
      pending={pending}
      error={error}
      onSubmit={async () => {
        const ok = await run(() =>
          api.put('/stocks/targets', {
            symbol,
            targetPriceCents,
            horizonMonths: Number(horizonMonths),
            rationale: rationale || undefined,
          }),
        );
        if (ok) onClose();
      }}
    >
      <p className="text-xs text-ink-muted">
        Your target overrides the suggestion, and it is what the debt payoff scenarios use.
      </p>
      <Field label="Target price per share">
        <MoneyInput valueCents={targetPriceCents} onChangeCents={setTargetPriceCents} currency={currency} />
      </Field>
      <Field label="Within how many months" hint="Also dates the share sale in the best case.">
        <Input
          type="number"
          min="1"
          max="120"
          required
          value={horizonMonths}
          onChange={(e) => setHorizonMonths(e.target.value)}
        />
      </Field>
      <Field label="Why this number">
        <Input value={rationale} onChange={(e) => setRationale(e.target.value)} />
      </Field>
    </Modal>
  );
}

function QuoteModal({ symbol, onClose }: { symbol: string; onClose: () => void }) {
  const [pricePerShareCents, setPricePerShareCents] = useState<number | undefined>(undefined);
  const [fiftyTwoWeekHighCents, setFiftyTwoWeekHighCents] = useState<number | undefined>(undefined);
  const { run, pending, error } = useAction();

  return (
    <Modal
      open
      onClose={onClose}
      title={`Set the price for ${symbol}`}
      pending={pending}
      error={error}
      onSubmit={async () => {
        const ok = await run(() =>
          api.put('/stocks/quote', { symbol, pricePerShareCents, fiftyTwoWeekHighCents }),
        );
        if (ok) onClose();
      }}
    >
      <p className="text-xs text-ink-muted">
        Saved as today&apos;s close and added to the price history, which is what the trend term of
        the suggested target reads from.
      </p>
      <Field label="Price per share">
        <MoneyInput required valueCents={pricePerShareCents} onChangeCents={setPricePerShareCents} />
      </Field>
      <Field label="52-week high" hint="Optional, but it improves the suggested target a lot.">
        <MoneyInput valueCents={fiftyTwoWeekHighCents} onChangeCents={setFiftyTwoWeekHighCents} />
      </Field>
    </Modal>
  );
}
