'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { PersonalPlan, PersonalSummary } from '@life-portal/shared-types';
import {
  PERSONAL_PLAN_STATUSES,
  PLAN_COMPANY,
  PLAN_TYPES,
} from '@life-portal/shared-types';
import { formatCents, formatDay, relativeDays } from '@life-portal/shared-domain';
import { AppShell, PageHeader } from '../../components/app-shell';
import {
  Chip,
  EmptyState,
  ErrorNote,
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

interface PersonalOverview {
  today: string;
  plans: PersonalPlan[];
  summary: PersonalSummary;
}

const STATUS_META: Record<string, { label: string; tone: 'neutral' | 'good' | 'warn' }> = {
  idea: { label: 'idea', tone: 'neutral' },
  planned: { label: 'planned', tone: 'warn' },
  booked: { label: 'booked', tone: 'good' },
  done: { label: 'done', tone: 'good' },
  cancelled: { label: 'cancelled', tone: 'neutral' },
};

const COMPANY_LABEL: Record<string, string> = {
  alone: 'on my own',
  girlfriend: 'with my girlfriend',
  friends: 'with friends',
  family: 'with family',
  other: '',
};

export default function PersonalPage() {
  return (
    <AppShell>
      <Personal />
    </AppShell>
  );
}

function Personal() {
  const { data, error, isLoading } = useApi<PersonalOverview>('/personal');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<PersonalPlan | null>(null);

  if (isLoading) return <Spinner />;
  if (error) return <ErrorNote message={(error as Error).message} />;
  if (!data) return null;

  const { summary } = data;
  const upcoming = data.plans.filter((plan) => plan.status === 'planned' || plan.status === 'booked');
  const ideas = data.plans.filter((plan) => plan.status === 'idea');
  const past = data.plans.filter((plan) => plan.status === 'done');

  return (
    <>
      <PageHeader
        title="Personal life"
        subtitle={
          summary.next
            ? `Next up: ${summary.next.title}, ${relativeDays(data.today, summary.next.date)}`
            : 'Nothing booked yet'
        }
        actions={
          <button type="button" className="btn-primary" onClick={() => setAdding(true)}>
            Add a plan
          </button>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Tile label="Booked or planned" value={String(summary.plannedCount)} />
        <Tile label="Ideas waiting" value={String(summary.ideaCount)} />
        <Tile
          label="Committed spending"
          value={formatCents(summary.upcomingCommittedCents, summary.currency)}
          hint="already in your budget"
        />
        <Tile
          label="Spent this year"
          value={formatCents(summary.spentThisYearCents, summary.currency)}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Panel title="Coming up" description={`${upcoming.length} planned`}>
            {upcoming.length === 0 ? (
              <EmptyState
                message="Nothing planned. That is worth fixing."
                action={
                  <button type="button" className="btn-primary" onClick={() => setAdding(true)}>
                    Plan something
                  </button>
                }
              />
            ) : (
              <ul className="divide-y divide-border">
                {upcoming.map((plan) => (
                  <PlanRow key={plan.id} plan={plan} today={data.today} onEdit={() => setEditing(plan)} />
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Ideas" description="No date yet, but worth remembering.">
            {ideas.length === 0 ? (
              <EmptyState message="No ideas saved." />
            ) : (
              <ul className="divide-y divide-border">
                {ideas.map((plan) => (
                  <PlanRow key={plan.id} plan={plan} today={data.today} onEdit={() => setEditing(plan)} />
                ))}
              </ul>
            )}
          </Panel>

          {past.length > 0 && (
            <Panel title="Been there, done that" description={`${past.length} finished`}>
              <ul className="divide-y divide-border">
                {past.map((plan) => (
                  <PlanRow key={plan.id} plan={plan} today={data.today} onEdit={() => setEditing(plan)} />
                ))}
              </ul>
            </Panel>
          )}
        </div>

        <div className="space-y-5">
          <Panel title="Places you have been" description={`${summary.countriesVisited.length} countries`}>
            {summary.countriesVisited.length === 0 ? (
              <EmptyState message="Nothing recorded yet." />
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {summary.countriesVisited.map((country) => (
                  <Chip key={country} tone="good">
                    {country}
                  </Chip>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Still want to go" description={`${summary.countriesWishlist.length} on the list`}>
            {summary.countriesWishlist.length === 0 ? (
              <EmptyState message="No destinations on the list." />
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {summary.countriesWishlist.map((country) => (
                  <Chip key={country}>{country}</Chip>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="How this touches your money">
            <p className="text-xs text-ink-muted">
              Tick &ldquo;add to my budget&rdquo; on a plan with a cost and a date, and it appears as
              one-off spending on the{' '}
              <Link href="/cashflow" className="text-sky-400 hover:underline">
                Free money
              </Link>{' '}
              page. Change the cost here and the budget follows — it is stored once.
            </p>
          </Panel>
        </div>
      </div>

      <PlanModal open={adding} onClose={() => setAdding(false)} today={data.today} />
      {editing && (
        <PlanModal open onClose={() => setEditing(null)} today={data.today} existing={editing} />
      )}
    </>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs uppercase tracking-wide text-ink-faint">{label}</p>
      <p className="tabular mt-1 text-xl font-semibold">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-ink-faint">{hint}</p>}
    </div>
  );
}

function PlanRow({
  plan,
  today,
  onEdit,
}: {
  plan: PersonalPlan;
  today: string;
  onEdit: () => void;
}) {
  const { run, pending } = useAction();
  const meta = STATUS_META[plan.status] ?? STATUS_META['idea'];
  const date = plan.targetDate ?? plan.startDate;

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium">{plan.title}</p>
          <Chip tone={meta.tone}>{meta.label}</Chip>
          <Chip>{plan.type.replace(/_/g, ' ')}</Chip>
          {plan.linkedExpenseId && (
            <Link href="/cashflow">
              <Chip tone="warn">in budget</Chip>
            </Link>
          )}
        </div>
        <p className="mt-0.5 text-xs text-ink-faint">
          {[COMPANY_LABEL[plan.company], [plan.city, plan.country].filter(Boolean).join(', ')]
            .filter(Boolean)
            .join(' · ')}
        </p>
        {date && (
          <p className="mt-0.5 text-xs text-ink-muted">
            {formatDay(date)}
            {plan.endDate && ` → ${formatDay(plan.endDate)}`}
            {plan.status !== 'done' && ` · ${relativeDays(today, date)}`}
          </p>
        )}
        {plan.description && <p className="mt-1 text-xs text-ink-faint">{plan.description}</p>}
      </div>

      <div className="shrink-0 text-right">
        <Money
          cents={plan.status === 'done' ? (plan.actualCostCents ?? plan.estimatedCostCents) : plan.estimatedCostCents}
          currency={plan.currency}
        />
        <p className="text-[11px] text-ink-faint">
          {plan.status === 'done' && plan.actualCostCents != null ? 'actually cost' : 'estimated'}
        </p>
        <div className="mt-1 flex justify-end gap-2">
          {plan.status !== 'done' && (
            <button
              type="button"
              className="text-[11px] text-emerald-400 hover:underline"
              disabled={pending}
              onClick={() => void run(() => api.patch(`/personal/${plan.id}`, { status: 'done' }))}
            >
              did it
            </button>
          )}
          <button type="button" className="text-[11px] text-ink-faint hover:text-ink" onClick={onEdit}>
            edit
          </button>
          <button
            type="button"
            className="text-[11px] text-ink-faint hover:text-rose-400"
            disabled={pending}
            onClick={() => void run(() => api.delete(`/personal/${plan.id}`))}
          >
            ✕
          </button>
        </div>
      </div>
    </li>
  );
}

function PlanModal({
  open,
  onClose,
  today,
  existing,
}: {
  open: boolean;
  onClose: () => void;
  today: string;
  existing?: PersonalPlan;
}) {
  const [form, setForm] = useState({
    title: existing?.title ?? '',
    type: (existing?.type ?? 'activity') as string,
    company: (existing?.company ?? 'alone') as string,
    status: (existing?.status ?? 'idea') as string,
    description: existing?.description ?? '',
    targetDate: existing?.targetDate ?? '',
    startDate: existing?.startDate ?? '',
    endDate: existing?.endDate ?? '',
    city: existing?.city ?? '',
    country: existing?.country ?? '',
    estimatedCostCents: existing?.estimatedCostCents as number | undefined,
    actualCostCents: existing?.actualCostCents as number | undefined,
    autoExpense: existing?.autoExpense ?? true,
    visited: existing?.visited ?? false,
  });
  const { run, pending, error } = useAction();
  const isTrip = form.type === 'trip';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={existing ? 'Edit plan' : 'Add a plan'}
      submitLabel={existing ? 'Save' : 'Add plan'}
      pending={pending}
      error={error}
      onSubmit={async () => {
        const body = {
          title: form.title,
          type: form.type,
          company: form.company,
          status: form.status,
          description: form.description || undefined,
          targetDate: isTrip ? undefined : form.targetDate || undefined,
          startDate: isTrip ? form.startDate || undefined : undefined,
          endDate: isTrip ? form.endDate || undefined : undefined,
          city: form.city || undefined,
          country: form.country || undefined,
          estimatedCostCents: form.estimatedCostCents,
          actualCostCents: form.actualCostCents,
          autoExpense: form.autoExpense,
          visited: form.visited,
        };
        const ok = await run(() =>
          existing ? api.patch(`/personal/${existing.id}`, body) : api.post('/personal', body),
        );
        if (ok) onClose();
      }}
    >
      <Field label="What is it">
        <Input
          required
          placeholder="Weekend in Batumi"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
        />
      </Field>

      <div className="grid grid-cols-3 gap-3">
        <Field label="Kind">
          <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            {PLAN_TYPES.map((option) => (
              <option key={option} value={option}>
                {option.replace(/_/g, ' ')}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="With who">
          <Select value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })}>
            {PLAN_COMPANY.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Status">
          <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            {PERSONAL_PLAN_STATUSES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {isTrip ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label="From">
            <Input
              type="date"
              value={form.startDate}
              onChange={(e) => setForm({ ...form, startDate: e.target.value })}
            />
          </Field>
          <Field label="To">
            <Input
              type="date"
              value={form.endDate}
              onChange={(e) => setForm({ ...form, endDate: e.target.value })}
            />
          </Field>
        </div>
      ) : (
        <Field label="When" hint="Leave blank to keep it as an idea.">
          <Input
            type="date"
            min={today}
            value={form.targetDate}
            onChange={(e) => setForm({ ...form, targetDate: e.target.value })}
          />
        </Field>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="City">
          <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
        </Field>
        <Field label="Country" hint="Feeds the places-been list.">
          <Input value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Estimated cost">
          <MoneyInput
            valueCents={form.estimatedCostCents}
            onChangeCents={(cents) => setForm({ ...form, estimatedCostCents: cents })}
          />
        </Field>
        {form.status === 'done' && (
          <Field label="What it actually cost">
            <MoneyInput
              valueCents={form.actualCostCents}
              onChangeCents={(cents) => setForm({ ...form, actualCostCents: cents })}
            />
          </Field>
        )}
      </div>

      <label className="flex items-start gap-2 rounded-lg border border-border px-3 py-2">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={form.autoExpense}
          onChange={(e) => setForm({ ...form, autoExpense: e.target.checked })}
        />
        <span className="text-xs text-ink-muted">
          Add to my budget, so it shows up as one-off spending in Free money. Needs a cost and a
          date.
        </span>
      </label>

      {form.type === 'trip' && (
        <label className="flex items-center gap-2 text-sm text-ink-muted">
          <input
            type="checkbox"
            checked={form.visited}
            onChange={(e) => setForm({ ...form, visited: e.target.checked })}
          />
          Already been there
        </label>
      )}

      <Field label="Notes">
        <Textarea
          rows={2}
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
      </Field>
    </Modal>
  );
}
