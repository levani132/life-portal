'use client';

import clsx from 'clsx';
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import type { WidgetTone } from '@life-portal/shared-types';
import { formatCents } from '@life-portal/shared-domain';

/** Tone → colour, in one place so "warn" looks the same on every screen. */
export const TONE_TEXT: Record<WidgetTone, string> = {
  neutral: 'text-ink',
  good: 'text-emerald-400',
  warn: 'text-amber-400',
  bad: 'text-rose-400',
};

export const TONE_CHIP: Record<WidgetTone, string> = {
  neutral: 'border-border text-ink-muted',
  good: 'border-emerald-500/40 text-emerald-300 bg-emerald-500/10',
  warn: 'border-amber-500/40 text-amber-300 bg-amber-500/10',
  bad: 'border-rose-500/40 text-rose-300 bg-rose-500/10',
};

export function Panel({
  title,
  description,
  actions,
  children,
  className,
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={clsx('card p-5', className)}>
      {(title || actions) && (
        <header className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0 flex-1">
            {title && <h2 className="text-sm font-semibold text-ink">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-ink-faint">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Chip({ tone = 'neutral', children }: { tone?: WidgetTone; children: ReactNode }) {
  return <span className={clsx('chip', TONE_CHIP[tone])}>{children}</span>;
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-ink-faint">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-rose-400">{error}</span>}
    </label>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={clsx('field', props.className)} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={clsx('field', props.className)} rows={props.rows ?? 3} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={clsx('field', props.className)} />;
}

/**
 * Money input that speaks whole currency units to the user and integer cents to the caller
 * (constitution principle II). Keeping the raw text in state lets the user type "1250." or
 * clear the box without it snapping back to 0 mid-keystroke.
 */
export function MoneyInput({
  valueCents,
  onChangeCents,
  currency = 'USD',
  placeholder,
  required,
  id,
}: {
  valueCents: number | undefined;
  onChangeCents: (cents: number | undefined) => void;
  currency?: string;
  placeholder?: string;
  required?: boolean;
  id?: string;
}) {
  const [text, setText] = useState(valueCents == null ? '' : String(valueCents / 100));
  const lastEmitted = useRef(valueCents);

  // Re-sync when the value changes from outside (a fetch landing, a form reset) but not
  // while the user is mid-edit, which would fight their typing.
  useEffect(() => {
    if (valueCents !== lastEmitted.current) {
      setText(valueCents == null ? '' : String(valueCents / 100));
      lastEmitted.current = valueCents;
    }
  }, [valueCents]);

  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-faint">
        {currency === 'USD' ? '$' : currency === 'EUR' ? '€' : '₾'}
      </span>
      <input
        id={id}
        className="field pl-7 tabular"
        inputMode="decimal"
        placeholder={placeholder ?? '0'}
        required={required}
        value={text}
        onChange={(event) => {
          const next = event.target.value;
          if (next !== '' && !/^\d*\.?\d{0,2}$/.test(next)) return;
          setText(next);
          const cents = next === '' ? undefined : Math.round(Number(next) * 100);
          lastEmitted.current = cents;
          onChangeCents(Number.isFinite(cents as number) ? cents : undefined);
        }}
      />
    </div>
  );
}

/** Right-aligned, tabular money for tables and stat rows. */
export function Money({
  cents,
  currency = 'USD',
  tone,
  className,
}: {
  cents: number | undefined | null;
  currency?: string;
  tone?: WidgetTone;
  className?: string;
}) {
  if (cents == null) return <span className="text-ink-faint">—</span>;
  return (
    <span className={clsx('tabular', tone && TONE_TEXT[tone], className)}>
      {formatCents(cents, currency)}
    </span>
  );
}

export function ProgressBar({ ratio, tone = 'good' }: { ratio: number; tone?: WidgetTone }) {
  const pct = Math.round(Math.min(1, Math.max(0, ratio)) * 100);
  const fill = {
    neutral: 'bg-ink-faint',
    good: 'bg-emerald-500',
    warn: 'bg-amber-500',
    bad: 'bg-rose-500',
  }[tone];
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-border" role="progressbar" aria-valuenow={pct}>
      <div className={clsx('h-full rounded-full transition-all', fill)} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  onSubmit,
  submitLabel = 'Save',
  pending,
  error,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  onSubmit?: (event: FormEvent) => void;
  submitLabel?: string;
  pending?: boolean;
  error?: string | null;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 pt-[10vh]">
      {/* Backdrop click closes; the dialog stops propagation so inner clicks do not. */}
      <div className="absolute inset-0" onClick={onClose} aria-hidden />
      <div
        className={clsx('card relative w-full p-5 shadow-2xl', wide ? 'max-w-2xl' : 'max-w-md')}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold">{title}</h3>
          <button type="button" className="text-ink-faint hover:text-ink" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit?.(event);
          }}
        >
          <div className="space-y-3">{children}</div>
          {error && (
            <p className="mt-3 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
              {error}
            </p>
          )}
          {onSubmit && (
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="btn-primary" disabled={pending}>
                {pending ? 'Saving…' : submitLabel}
              </button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}

export function EmptyState({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center">
      <p className="text-sm text-ink-faint">{message}</p>
      {action && <div className="mt-3 flex justify-center">{action}</div>}
    </div>
  );
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-ink-faint">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-sky-500" />
      {label}
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
      {message}
    </div>
  );
}

/**
 * Marks a figure the system estimated rather than recorded, with the reasoning behind it
 * (constitution principle VI). The `title` carries the full basis for a hover.
 */
export function EstimateMark({ basis }: { basis?: string }) {
  return (
    <span
      className="ml-1 cursor-help align-super text-[10px] text-ink-faint"
      title={basis ?? 'Estimated, not recorded'}
    >
      est
    </span>
  );
}
