'use client';

import clsx from 'clsx';
import { useState } from 'react';
import { Ban, Check, ChevronDown, CircleDashed, CircleHelp, Coins, Flag, Hammer, Rocket, ShieldAlert, Sparkles, type LucideIcon } from 'lucide-react';
import type { PortalState, Roadmap, RoadmapStatus, RoadmapStep } from '@life-portal/shared-types';
import { formatDay } from '@life-portal/shared-domain';
import { AppShell } from '../../../components/app-shell';
import { ErrorNote, Spinner } from '../../../components/ui';
import { useApi } from '../../../lib/hooks';

export default function RoadmapPage() {
  return (
    <AppShell>
      <RoadmapView />
    </AppShell>
  );
}

/** How each state reads and looks. Class names are written out in full for Tailwind. */
const STATUS: Record<RoadmapStatus, { label: string; icon: LucideIcon; chip: string; node: string; bar: string }> = {
  done: { label: 'Done', icon: Check, chip: 'bg-success-solid/15 text-success', node: 'bg-success-solid text-white', bar: 'bg-success-solid' },
  built: { label: 'Built, partly off', icon: Hammer, chip: 'bg-info-solid/15 text-info', node: 'bg-info-solid text-white', bar: 'bg-info-solid' },
  partial: { label: 'Started', icon: CircleDashed, chip: 'bg-warning-solid/15 text-warning', node: 'bg-warning-solid text-white', bar: 'bg-warning-solid' },
  next: { label: 'Next', icon: Rocket, chip: 'bg-accent-solid/15 text-accent', node: 'bg-accent-solid text-on-accent', bar: 'bg-accent-solid' },
  later: { label: 'Later', icon: Flag, chip: 'bg-ink-faint/15 text-ink-muted', node: 'bg-surface-raised text-ink-muted ring-1 ring-border', bar: 'bg-border' },
};
const ORDER: RoadmapStatus[] = ['done', 'built', 'partial', 'next', 'later'];

/**
 * The roadmap, for the developer account: where the app is, what comes next and in what order,
 * what must be closed before launch, and the decisions waiting for the owner. The same content
 * as `docs/ROADMAP.md`, served by the API so it is not in every visitor's bundle.
 */
function RoadmapView() {
  const portal = useApi<PortalState>('/portal');
  const allowed = portal.data?.cohort === 'developer';
  const roadmap = useApi<Roadmap>(allowed ? '/roadmap' : null);
  if (!portal.data) return <Spinner />;
  if (!allowed) return <ErrorNote message="The roadmap is for the developer." />;
  if (roadmap.error) return <ErrorNote message={(roadmap.error as Error).message} />;
  if (!roadmap.data) return <Spinner />;
  const data = roadmap.data;
  const counts = ORDER.map((status) => ({ status, count: data.steps.filter((step) => step.status === status).length })).filter((item) => item.count > 0);

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-6">
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-train-pull-solid via-train-arms-solid to-train-cardio-solid p-5 text-white shadow-lg sm:p-7">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-white/75">Roadmap · updated {formatDay(data.updated)}</p>
        <h1 className="mt-2 text-xl font-bold leading-snug sm:text-2xl">{data.direction}</h1>
        <div className="mt-5 flex h-2 gap-0.5 overflow-hidden rounded-full bg-white/20" role="img" aria-label={counts.map((item) => `${item.count} ${STATUS[item.status].label.toLowerCase()}`).join(', ')}>
          {counts.map((item) => (
            <span key={item.status} className={clsx('h-full', item.status === 'later' ? 'bg-white/25' : 'bg-white', item.status === 'next' && 'opacity-70', item.status === 'partial' && 'opacity-80')} style={{ flexGrow: item.count }} />
          ))}
        </div>
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-white/90">
          {counts.map((item) => (
            <li key={item.status}>
              <span className="font-bold tabular">{item.count}</span> {STATUS[item.status].label.toLowerCase()}
            </li>
          ))}
        </ul>
      </section>

      <Section icon={Rocket} title="What comes next" hint="In order. Tap a step for its details.">
        <ol className="relative space-y-2">
          <span className="absolute bottom-4 left-[15px] top-4 w-px bg-border" aria-hidden />
          {data.steps.map((step, index) => (
            <Step key={step.title} step={step} number={index + 1} />
          ))}
        </ol>
      </Section>

      <Section icon={CircleHelp} title="Decisions waiting for you" hint="Only you can answer these.">
        <ul className="grid gap-2 sm:grid-cols-2">
          {data.decisions.map((decision) => (
            <li key={decision.question} className="rounded-2xl border border-accent/30 bg-accent-solid/[0.07] p-3.5">
              <p className="text-sm font-semibold">{decision.question}</p>
              <p className="mt-1 text-[13px] leading-snug text-ink-muted">{decision.detail}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section icon={Sparkles} title="Built so far" hint="What exists today.">
        <ul className="grid gap-2 sm:grid-cols-2">
          {data.areas.map((area) => (
            <li key={area.name} className="card p-3.5">
              <p className="text-sm font-bold">{area.name}</p>
              <ul className="mt-2 space-y-1">
                {area.items.map((item) => (
                  <li key={item} className="flex items-start gap-1.5 text-[13px] leading-snug text-ink-muted">
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-hidden /> {item}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </Section>

      <Section icon={ShieldAlert} title="Before a public launch" hint="Not the next step: a gate for the day launch is scheduled.">
        <ul className="card divide-y divide-border">
          {data.gaps.map((gap) => (
            <li key={gap.title} className="flex items-start gap-2.5 p-3.5">
              <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-warning-solid" aria-hidden />
              <span>
                <span className="block text-sm font-semibold">{gap.title}</span>
                <span className="block text-[13px] leading-snug text-ink-muted">{gap.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section icon={Coins} title="Business model" hint="The core stays free.">
        <ul className="grid gap-2 sm:grid-cols-2">
          {data.business.map((item) => (
            <li key={item.title} className="card p-3.5">
              <p className="text-sm font-semibold">{item.title}</p>
              <p className="mt-1 text-[13px] leading-snug text-ink-muted">{item.detail}</p>
            </li>
          ))}
        </ul>
        <p className="mt-2 flex items-start gap-2 rounded-2xl border border-danger-solid/30 bg-danger-solid/[0.07] p-3.5 text-[13px] leading-snug">
          <Ban className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />
          <span>
            <span className="font-semibold">Ruled out:</span> {data.ruledOut}
          </span>
        </p>
      </Section>
    </div>
  );
}

function Section({ icon: Icon, title, hint, children }: { icon: LucideIcon; title: string; hint: string; children: React.ReactNode }) {
  return (
    <section>
      <header className="mb-2.5 flex items-center gap-2 px-1">
        <Icon className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden />
        <h2 className="text-base font-bold">{title}</h2>
        <span className="truncate text-xs text-ink-faint">{hint}</span>
      </header>
      {children}
    </section>
  );
}

function Step({ step, number }: { step: RoadmapStep; number: number }) {
  const status = STATUS[step.status];
  const StatusIcon = status.icon;
  // The steps being worked towards open by themselves; the rest are a line until tapped.
  const [open, setOpen] = useState(step.status === 'next' && number <= 4);
  const hasPoints = !!step.points?.length;
  return (
    <li className="relative flex gap-3">
      <span className={clsx('relative z-10 mt-2.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular', status.node)} aria-hidden>
        {step.status === 'done' ? <Check className="h-4 w-4" strokeWidth={3} /> : number}
      </span>
      <div className={clsx('card min-w-0 flex-1 overflow-hidden', step.status === 'done' && 'opacity-70')}>
        <button
          type="button"
          className="flex w-full items-start gap-2 p-3.5 text-left"
          aria-expanded={hasPoints ? open : undefined}
          disabled={!hasPoints}
          onClick={() => setOpen((value) => !value)}
        >
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className={clsx('text-[15px] font-bold leading-snug', step.status === 'done' && 'line-through decoration-ink-faint')}>{step.title}</span>
              <span className={clsx('flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold', status.chip)}>
                <StatusIcon className="h-3 w-3" aria-hidden /> {status.label}
              </span>
            </span>
            <span className="mt-1 block text-[13px] leading-snug text-ink-muted">{step.summary}</span>
          </span>
          {hasPoints && <ChevronDown className={clsx('mt-1 h-4 w-4 shrink-0 text-ink-faint transition-transform duration-200', open && 'rotate-180')} aria-hidden />}
        </button>
        {hasPoints && open && (
          <ul className="space-y-1.5 border-t border-border px-3.5 py-3">
            {step.points?.map((point) => (
              <li key={point} className="flex items-start gap-2 text-[13px] leading-snug">
                <span className={clsx('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', status.bar)} aria-hidden />
                {point}
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}
