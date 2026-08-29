'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { IngestTokenCreated, IngestTokenSummary } from '@life-portal/shared-types';
import { addYears, formatDay, localDay, relativeDays } from '@life-portal/shared-domain';
import { AppShell, PageHeader } from '../../../components/app-shell';
import {
  Chip,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Modal,
  Panel,
  Spinner,
} from '../../../components/ui';
import { api } from '../../../lib/api';
import { useAction, useApi } from '../../../lib/hooks';

const INGEST_URL = `${
  process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3333/api'
}/spending/ingest`;

export default function IngestTokensPage() {
  return (
    <AppShell>
      <IngestTokens />
    </AppShell>
  );
}

function IngestTokens() {
  const tokens = useApi<IngestTokenSummary[]>('/spending/tokens');
  const [creating, setCreating] = useState(false);
  // Held in memory only, and only until the owner dismisses it: this value exists nowhere else.
  const [revealed, setRevealed] = useState<IngestTokenCreated | null>(null);
  // The owner's day, resolved after mount — the server's day is not necessarily theirs.
  const [today, setToday] = useState<string | null>(null);

  useEffect(() => setToday(localDay(new Date())), []);

  if (tokens.isLoading) return <Spinner label="Checking your tokens…" />;
  if (tokens.error) return <ErrorNote message={(tokens.error as Error).message} />;
  if (!tokens.data) return null;

  const live = tokens.data.filter((token) => !token.revokedAt);
  const working = live.some((token) => token.lastUsedAt);

  return (
    <>
      <PageHeader
        title="Message capture"
        subtitle="One token per phone. It is how a Shortcut proves a forwarded message is yours."
        actions={
          <>
            <Link href="/cashflow" className="btn-ghost">
              Back to free money
            </Link>
            <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
              New token
            </button>
          </>
        }
      />

      <div className="space-y-5">
        {revealed && <Revealed created={revealed} onDismiss={() => setRevealed(null)} />}

        <Panel
          title="Tokens"
          description={
            working
              ? 'A token with a recent last-used is your proof that capture is still running.'
              : 'Nothing has ever forwarded a message with these.'
          }
        >
          {tokens.data.length === 0 ? (
            <EmptyState
              message="No tokens yet. Nothing can send you a message until one exists."
              action={
                <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
                  Create one
                </button>
              }
            />
          ) : (
            <ul className="divide-y divide-border">
              {tokens.data.map((token) => (
                <TokenRow
                  key={token.id}
                  token={token}
                  today={today}
                  onChanged={() => tokens.mutate()}
                />
              ))}
            </ul>
          )}
        </Panel>

        <SetupInstructions token={revealed?.token} />
      </div>

      {creating && (
        <CreateTokenModal
          today={today}
          onClose={() => setCreating(false)}
          onCreated={async (created) => {
            setRevealed(created);
            await tokens.mutate();
          }}
        />
      )}
    </>
  );
}

/**
 * The one moment the plain token exists outside the phone.
 *
 * Loud on purpose: only a bcrypt hash is stored, so a token lost here is lost for good and the
 * only remedy is minting another.
 */
function Revealed({ created, onDismiss }: { created: IngestTokenCreated; onDismiss: () => void }) {
  return (
    <section className="card border-emerald-500/50 bg-emerald-500/5 p-5">
      <h2 className="text-sm font-semibold text-emerald-300">
        Copy this now — it will never be shown again
      </h2>
      <p className="mt-1 text-xs text-ink-muted">
        Only a hash of it is stored, so nothing here or anywhere else can show it to you a second
        time. Paste it into the Shortcut before you leave this page; if you lose it, the fix is a
        new token, not a lookup.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <Input readOnly value={created.token} aria-label="Ingest token" />
        </div>
        <CopyButton value={created.token} label="Copy token" />
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button type="button" className="btn-ghost" onClick={onDismiss}>
          I have saved it
        </button>
        <span className="text-xs text-ink-faint">{created.label}</span>
      </div>
    </section>
  );
}

function TokenRow({
  token,
  today,
  onChanged,
}: {
  token: IngestTokenSummary;
  today: string | null;
  onChanged: () => Promise<unknown>;
}) {
  const { run, pending, error } = useAction();
  const revoked = Boolean(token.revokedAt);
  const expired = today != null && token.expiresAt < today;

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-medium">{token.label}</p>
          {revoked && <Chip tone="bad">revoked</Chip>}
          {!revoked && expired && <Chip tone="bad">expired</Chip>}
        </div>

        {/*
         * Last used is the column that matters: it is the only evidence that the automation on
         * the phone is still firing, and it is stamped only when a message actually lands.
         */}
        {token.lastUsedAt ? (
          <p className="mt-0.5 text-xs text-emerald-400">
            Last message {formatDay(token.lastUsedAt.slice(0, 10))}
            {today && ` · ${relativeDays(today, token.lastUsedAt.slice(0, 10))}`}
          </p>
        ) : (
          <p className="mt-0.5 text-xs text-amber-400">
            Not used yet — capture is not working. Nothing has ever sent a message with this token.
          </p>
        )}

        <p className="mt-0.5 text-xs text-ink-faint">
          {revoked
            ? `Revoked ${formatDay(token.revokedAt as string)}`
            : `${expired ? 'Expired' : 'Expires'} ${formatDay(token.expiresAt)}`}
        </p>
        {error && <p className="mt-1 text-xs text-rose-400">{error}</p>}
      </div>

      {!revoked && (
        <button
          type="button"
          className="btn-ghost shrink-0 text-xs"
          disabled={pending}
          onClick={() =>
            void run(async () => {
              await api.delete(`/spending/tokens/${token.id}`);
              await onChanged();
            })
          }
        >
          {pending ? 'Revoking…' : 'Revoke'}
        </button>
      )}
    </li>
  );
}

function CreateTokenModal({
  today,
  onClose,
  onCreated,
}: {
  today: string | null;
  onClose: () => void;
  onCreated: (created: IngestTokenCreated) => Promise<unknown>;
}) {
  const [label, setLabel] = useState('');
  const [expiresAt, setExpiresAt] = useState(today ? addYears(today, 1) : '');
  const { run, pending, error } = useAction();

  return (
    <Modal
      open
      onClose={onClose}
      title="New capture token"
      submitLabel="Create token"
      pending={pending}
      error={error}
      onSubmit={async () => {
        const ok = await run(async () => {
          const created = await api.post<IngestTokenCreated>('/spending/tokens', {
            label,
            expiresAt,
          });
          await onCreated(created);
        });
        if (ok) onClose();
      }}
    >
      <Field label="What is it for" hint="Name the phone, so a lost one is obvious to revoke.">
        <Input
          required
          maxLength={60}
          placeholder="iPhone"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
        />
      </Field>

      <Field label="Expires" hint="A year out by default. Capture stops dead on this date.">
        <Input
          required
          type="date"
          min={today ?? undefined}
          value={expiresAt}
          onChange={(event) => setExpiresAt(event.target.value)}
        />
      </Field>
    </Modal>
  );
}

/** The Shortcut, written out step by step, because it is set up once and forgotten. */
function SetupInstructions({ token }: { token?: string }) {
  return (
    <Panel
      title="Setting up the iOS Shortcut"
      description="One automation per bank. Ten minutes, once, and then it runs itself."
    >
      <div className="space-y-4 text-sm text-ink-muted">
        <div className="rounded-lg border border-border bg-surface p-3">
          <p className="label">Endpoint</p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 break-all text-xs text-ink">{INGEST_URL}</code>
            <CopyButton value={INGEST_URL} label="Copy URL" />
          </div>
          {token ? (
            <div className="mt-3">
              <p className="label">Token</p>
              <div className="flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 break-all text-xs text-ink">{token}</code>
                <CopyButton value={token} label="Copy token" />
              </div>
            </div>
          ) : (
            <p className="mt-2 text-xs text-ink-faint">
              Create a token above and its value appears here to copy, once.
            </p>
          )}
        </div>

        <ol className="list-decimal space-y-2 pl-5 text-xs">
          <li>
            Open <strong className="text-ink">Shortcuts</strong> and go to the{' '}
            <strong className="text-ink">Automation</strong> tab.
          </li>
          <li>
            Tap <strong className="text-ink">+</strong>, then{' '}
            <strong className="text-ink">Message</strong>.
          </li>
          <li>
            Set <strong className="text-ink">Sender</strong> to{' '}
            <code className="text-ink">4444</code> for Bank of Georgia. For TBC the sender is{' '}
            <code className="text-ink">TBC SMS</code>, but iOS tends to strip the space when you
            type it — if it becomes <code className="text-ink">TBCSMS</code>, skip the sender and
            set <strong className="text-ink">Message Contains</strong> to{' '}
            <code className="text-ink">Nashti</code> instead: every TBC payment message carries it,
            and codes or marketing do not. The app never checks the sender — this filter only
            decides when your phone fires. One automation per bank either way.
          </li>
          <li>
            Choose <strong className="text-ink">Run Immediately</strong> and turn{' '}
            <strong className="text-ink">Notify When Run</strong> off, so a message arriving does
            not interrupt you.
          </li>
          <li>
            Tap <strong className="text-ink">New Blank Automation</strong>.
          </li>
          <li>
            Add <strong className="text-ink">Get Contents of URL</strong> and paste the endpoint
            above into it.
          </li>
          <li>
            Open its arrow and set <strong className="text-ink">Method</strong> to{' '}
            <strong className="text-ink">POST</strong>.
          </li>
          <li>
            Under <strong className="text-ink">Headers</strong>, add{' '}
            <code className="text-ink">X-Ingest-Token</code> with your token as the value, and{' '}
            <code className="text-ink">Content-Type</code> with{' '}
            <code className="text-ink">application/json</code>.
          </li>
          <li>
            Set <strong className="text-ink">Request Body</strong> to{' '}
            <strong className="text-ink">JSON</strong> and add these four fields:
            <ul className="mt-1 space-y-1 pl-1">
              <li>
                <code className="text-ink">source</code> — Text —{' '}
                <code className="text-ink">sms</code>
              </li>
              <li>
                <code className="text-ink">bank</code> — Text —{' '}
                <code className="text-ink">bog</code> or <code className="text-ink">tbc</code>,
                matching the sender this automation listens to
              </li>
              <li>
                <code className="text-ink">raw</code> — Text — the{' '}
                <strong className="text-ink">Shortcut Input</strong> variable, set to{' '}
                <strong className="text-ink">Content</strong>
              </li>
              <li>
                <code className="text-ink">at</code> — Text — the{' '}
                <strong className="text-ink">Current Date</strong> variable
              </li>
            </ul>
          </li>
          <li>
            Save, then repeat the whole thing for the other bank with its own sender and{' '}
            <code className="text-ink">bank</code> value.
          </li>
        </ol>

        <p className="text-xs text-ink-faint">
          The next bank message that arrives will show up on the{' '}
          <Link href="/cashflow" className="text-sky-400 hover:underline">
            free money page
          </Link>{' '}
          and stamp this token&rsquo;s last-used. A message the parser cannot read is still kept —
          it queues there for you rather than being dropped.
        </p>
      </div>
    </Panel>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => {
    if (state === 'idle') return;
    const timer = setTimeout(() => setState('idle'), 2500);
    return () => clearTimeout(timer);
  }, [state]);

  return (
    <button
      type="button"
      className="btn-ghost shrink-0 text-xs"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setState('copied');
        } catch {
          // Clipboard access needs a secure context; over plain HTTP there is nothing to do but
          // tell the owner to select the text themselves.
          setState('failed');
        }
      }}
    >
      {state === 'copied' ? 'Copied' : state === 'failed' ? 'Select it by hand' : label}
    </button>
  );
}
