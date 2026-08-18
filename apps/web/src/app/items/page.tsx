'use client';

import { useState } from 'react';
import type { ItemsSummary, SellableItem } from '@life-portal/shared-types';
import { ITEM_STATUSES } from '@life-portal/shared-types';
import { formatCents, formatDay } from '@life-portal/shared-domain';
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
  Textarea,
} from '../../components/ui';
import { api } from '../../lib/api';
import { useAction, useApi } from '../../lib/hooks';
import type { Loan } from '@life-portal/shared-types';

interface ItemsOverview {
  items: SellableItem[];
  summary: ItemsSummary;
}

/** Status → chip tone and label, so the list reads at a glance. */
const STATUS_META: Record<string, { tone: 'neutral' | 'good' | 'warn' | 'bad'; label: string }> = {
  draft: { tone: 'neutral', label: 'not listed' },
  listed: { tone: 'warn', label: 'listed' },
  has_interest: { tone: 'good', label: 'buyer interested' },
  reserved: { tone: 'good', label: 'reserved' },
  sold: { tone: 'good', label: 'sold' },
  abandoned: { tone: 'neutral', label: 'keeping it' },
};

export default function ItemsPage() {
  return (
    <AppShell>
      <Items />
    </AppShell>
  );
}

function Items() {
  const { data, error, isLoading } = useApi<ItemsOverview>('/items');
  const { data: loansData } = useApi<{ loans: { loan: Loan }[] }>('/loans');
  const [adding, setAdding] = useState(false);
  const [selling, setSelling] = useState<SellableItem | null>(null);

  if (isLoading) return <Spinner />;
  if (error) return <ErrorNote message={(error as Error).message} />;
  if (!data) return null;

  const { summary } = data;
  const loans = (loansData?.loans ?? []).map((entry) => entry.loan);
  const open = data.items.filter((item) => !['sold', 'abandoned'].includes(item.status));
  const closed = data.items.filter((item) => ['sold', 'abandoned'].includes(item.status));

  return (
    <>
      <PageHeader
        title="Items to sell"
        subtitle={`${summary.openCount} still to sell · ${formatCents(summary.expectedProceedsCents, summary.currency)} expected`}
        actions={
          <button type="button" className="btn-primary" onClick={() => setAdding(true)}>
            Add an item
          </button>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Tile
          label="Realistic total"
          value={formatCents(summary.expectedProceedsCents, summary.currency)}
          hint="what you actually expect"
          estimated
        />
        <Tile
          label="If everything sells at asking"
          value={formatCents(summary.optimisticProceedsCents, summary.currency)}
          estimated
        />
        <Tile
          label="If you have to haggle hard"
          value={formatCents(summary.pessimisticProceedsCents, summary.currency)}
          estimated
        />
        <Tile
          label="Already sold"
          value={formatCents(summary.realisedProceedsCents, summary.currency)}
          hint={`${summary.soldCount} items`}
        />
      </div>

      <div className="space-y-5">
        <Panel title="Still to sell" description={`${open.length} items`}>
          {open.length === 0 ? (
            <EmptyState
              message="Nothing waiting to be sold."
              action={
                <button type="button" className="btn-primary" onClick={() => setAdding(true)}>
                  Add an item
                </button>
              }
            />
          ) : (
            <ul className="divide-y divide-border">
              {open.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  loans={loans}
                  onSell={() => setSelling(item)}
                />
              ))}
            </ul>
          )}
        </Panel>

        {closed.length > 0 && (
          <Panel title="Done" description={`${closed.length} sold or kept`}>
            <ul className="divide-y divide-border">
              {closed.map((item) => (
                <ItemRow key={item.id} item={item} loans={loans} />
              ))}
            </ul>
          </Panel>
        )}
      </div>

      <ItemModal open={adding} onClose={() => setAdding(false)} loans={loans} />
      {selling && (
        <SellModal item={selling} loans={loans} onClose={() => setSelling(null)} />
      )}
    </>
  );
}

function Tile({
  label,
  value,
  hint,
  estimated,
}: {
  label: string;
  value: string;
  hint?: string;
  estimated?: boolean;
}) {
  return (
    <div className="card p-4">
      <p className="text-xs uppercase tracking-wide text-ink-faint">{label}</p>
      <p className="tabular mt-1 text-xl font-semibold">
        {value}
        {estimated && <EstimateMark basis="Based on the prices you entered, not on offers received." />}
      </p>
      {hint && <p className="mt-0.5 text-[11px] text-ink-faint">{hint}</p>}
    </div>
  );
}

function ItemRow({
  item,
  loans,
  onSell,
}: {
  item: SellableItem;
  loans: Loan[];
  onSell?: () => void;
}) {
  const { run, pending } = useAction();
  const [editing, setEditing] = useState(false);
  const meta = STATUS_META[item.status] ?? STATUS_META['draft'];
  const earmarked = loans.find((loan) => loan.id === item.allocateToLoanId);

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium">{item.name}</p>
            <Chip tone={meta.tone}>{meta.label}</Chip>
            {earmarked && <Chip tone="warn">→ {earmarked.lender}</Chip>}
          </div>
          {item.description && (
            <p className="mt-0.5 line-clamp-1 text-xs text-ink-faint">{item.description}</p>
          )}
          <p className="mt-1 text-xs text-ink-faint">
            asking {formatCents(item.askingPriceCents, item.currency)}
            {item.minPriceCents != null &&
              ` · walk away below ${formatCents(item.minPriceCents, item.currency)}`}
            {item.expectedSaleDate && ` · expect to sell by ${formatDay(item.expectedSaleDate)}`}
            {item.soldAt && ` · sold ${formatDay(item.soldAt)}`}
          </p>
          {item.interests.length > 0 && (
            <p className="mt-1 text-xs text-emerald-400">
              {item.interests.length} interested:{' '}
              {item.interests.map((interest) => interest.name).join(', ')}
            </p>
          )}
        </div>

        <div className="shrink-0 text-right">
          <Money
            cents={item.status === 'sold' ? item.soldPriceCents : item.expectedPriceCents}
            currency={item.currency}
            tone={item.status === 'sold' ? 'good' : undefined}
            className="text-sm font-medium"
          />
          <p className="text-[11px] text-ink-faint">{item.status === 'sold' ? 'sold for' : 'realistic'}</p>
          <div className="mt-1 flex justify-end gap-2">
            {onSell && (
              <button type="button" className="text-[11px] text-emerald-400 hover:underline" onClick={onSell}>
                mark sold
              </button>
            )}
            <button
              type="button"
              className="text-[11px] text-ink-faint hover:text-ink"
              onClick={() => setEditing(true)}
            >
              edit
            </button>
            <button
              type="button"
              className="text-[11px] text-ink-faint hover:text-rose-400"
              disabled={pending}
              onClick={() => void run(() => api.delete(`/items/${item.id}`))}
            >
              ✕
            </button>
          </div>
        </div>
      </div>

      {editing && (
        <ItemModal open onClose={() => setEditing(false)} loans={loans} existing={item} />
      )}
    </li>
  );
}

function ItemModal({
  open,
  onClose,
  loans,
  existing,
}: {
  open: boolean;
  onClose: () => void;
  loans: Loan[];
  existing?: SellableItem;
}) {
  const [form, setForm] = useState({
    name: existing?.name ?? '',
    description: existing?.description ?? '',
    askingPriceCents: existing?.askingPriceCents as number | undefined,
    expectedPriceCents: existing?.expectedPriceCents as number | undefined,
    minPriceCents: existing?.minPriceCents as number | undefined,
    status: (existing?.status ?? 'draft') as string,
    allocateToLoanId: existing?.allocateToLoanId ?? '',
    expectedSaleDate: existing?.expectedSaleDate ?? '',
  });
  const { run, pending, error } = useAction();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={existing ? 'Edit item' : 'Add an item to sell'}
      submitLabel={existing ? 'Save' : 'Add item'}
      pending={pending}
      error={error}
      onSubmit={async () => {
        const body = {
          name: form.name,
          description: form.description || undefined,
          askingPriceCents: form.askingPriceCents ?? 0,
          expectedPriceCents: form.expectedPriceCents ?? form.askingPriceCents ?? 0,
          minPriceCents: form.minPriceCents,
          status: form.status,
          allocateToLoanId: form.allocateToLoanId || undefined,
          expectedSaleDate: form.expectedSaleDate || undefined,
        };
        const ok = await run(() =>
          existing ? api.patch(`/items/${existing.id}`, body) : api.post('/items', body),
        );
        if (ok) onClose();
      }}
    >
      <Field label="What is it">
        <Input
          required
          placeholder="iPhone 13, 128 GB"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
      </Field>
      <Field label="Description">
        <Textarea
          rows={2}
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
      </Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Asking">
          <MoneyInput
            required
            valueCents={form.askingPriceCents}
            onChangeCents={(cents) => setForm({ ...form, askingPriceCents: cents })}
          />
        </Field>
        <Field label="Realistic">
          <MoneyInput
            valueCents={form.expectedPriceCents}
            onChangeCents={(cents) => setForm({ ...form, expectedPriceCents: cents })}
          />
        </Field>
        <Field label="Walk away">
          <MoneyInput
            valueCents={form.minPriceCents}
            onChangeCents={(cents) => setForm({ ...form, minPriceCents: cents })}
          />
        </Field>
      </div>
      <p className="text-xs text-ink-faint">
        The realistic price is what projections use. Leave it blank to use the asking price.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Status">
          <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            {ITEM_STATUSES.map((option) => (
              <option key={option} value={option}>
                {STATUS_META[option]?.label ?? option}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Expect to sell by">
          <Input
            type="date"
            value={form.expectedSaleDate}
            onChange={(e) => setForm({ ...form, expectedSaleDate: e.target.value })}
          />
        </Field>
      </div>
      <Field label="Put the money towards" hint="Earmarking feeds the debt payoff scenarios.">
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

/**
 * Marking an item sold optionally records the proceeds straight onto the earmarked debt, so
 * the money does not have to be entered twice.
 */
function SellModal({
  item,
  loans,
  onClose,
}: {
  item: SellableItem;
  loans: Loan[];
  onClose: () => void;
}) {
  const [soldPriceCents, setSoldPriceCents] = useState<number | undefined>(item.expectedPriceCents);
  const [recordPayment, setRecordPayment] = useState(Boolean(item.allocateToLoanId));
  const { run, pending, error } = useAction();
  const loan = loans.find((entry) => entry.id === item.allocateToLoanId);

  return (
    <Modal
      open
      onClose={onClose}
      title={`Sold: ${item.name}`}
      submitLabel="Mark as sold"
      pending={pending}
      error={error}
      onSubmit={async () => {
        const ok = await run(async () => {
          await api.post(`/items/${item.id}/sold`, { soldPriceCents });
          if (recordPayment && loan && soldPriceCents) {
            await api.post(`/loans/${loan.id}/payments`, {
              amountCents: soldPriceCents,
              source: 'item_sale',
              sourceRefId: item.id,
              note: `Sold ${item.name}`,
            });
          }
        });
        if (ok) onClose();
      }}
    >
      <Field label="What did it actually sell for">
        <MoneyInput
          required
          valueCents={soldPriceCents}
          onChangeCents={setSoldPriceCents}
          currency={item.currency}
        />
      </Field>
      {loan && (
        <label className="flex items-start gap-2 rounded-lg border border-border px-3 py-2">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={recordPayment}
            onChange={(e) => setRecordPayment(e.target.checked)}
          />
          <span className="text-xs text-ink-muted">
            Also record this as a payment towards {loan.lender}.
          </span>
        </label>
      )}
    </Modal>
  );
}
