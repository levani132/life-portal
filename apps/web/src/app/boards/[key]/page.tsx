'use client';

import clsx from 'clsx';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import type {
  BoardNote,
  BoardSummary,
  BoardTask,
  Board as BoardType,
  Contribution,
  Person,
  Win,
} from '@life-portal/shared-types';
import {
  ATTENTION_STATES,
  CONTRIBUTION_TYPES,
  TASK_STATUSES,
} from '@life-portal/shared-types';
import { formatDay, relativeDays } from '@life-portal/shared-domain';
import { AppShell, PageHeader } from '../../../components/app-shell';
import {
  Chip,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  Modal,
  Panel,
  Select,
  Spinner,
  Textarea,
} from '../../../components/ui';
import { api } from '../../../lib/api';
import { useAction, useApi } from '../../../lib/hooks';

interface BoardDetail {
  board: BoardType;
  tasks: BoardTask[];
  notes: BoardNote[];
  people: (Person & { oneOnOneOverdue: boolean })[];
  contributions: Contribution[];
  wins: Win[];
  summary: BoardSummary;
}

const PRIORITY_META: Record<number, { label: string; tone: 'bad' | 'warn' | 'neutral' }> = {
  1: { label: 'now', tone: 'bad' },
  2: { label: 'soon', tone: 'warn' },
  3: { label: 'normal', tone: 'neutral' },
  4: { label: 'someday', tone: 'neutral' },
};

const ATTENTION_META: Record<string, { label: string; tone: 'good' | 'warn' | 'bad' | 'neutral' }> = {
  ok: { label: 'fine', tone: 'good' },
  upcoming: { label: 'will need me', tone: 'warn' },
  needs_attention: { label: 'needs me now', tone: 'bad' },
  at_risk: { label: 'at risk', tone: 'bad' },
};

export default function BoardPage() {
  const params = useParams<{ key: string }>();
  return (
    <AppShell>
      <Board boardKey={params.key} />
    </AppShell>
  );
}

function Board({ boardKey }: { boardKey: string }) {
  const { data, error, isLoading } = useApi<BoardDetail>(`/boards/${boardKey}`);
  const [addingTask, setAddingTask] = useState(false);
  const [addingPerson, setAddingPerson] = useState(false);
  const [addingContribution, setAddingContribution] = useState(false);
  const [addingNote, setAddingNote] = useState(false);
  const [addingWin, setAddingWin] = useState(false);

  if (isLoading) return <Spinner />;
  if (error) return <ErrorNote message={(error as Error).message} />;
  if (!data) return null;

  const { board, summary } = data;
  const has = (feature: string) => board.features.includes(feature as never);
  const open = data.tasks.filter((task) => task.status !== 'done');
  const done = data.tasks.filter((task) => task.status === 'done');

  return (
    <>
      <PageHeader
        title={board.name}
        subtitle={board.description}
        actions={
          <>
            {has('notes') && (
              <button type="button" className="btn-ghost" onClick={() => setAddingNote(true)}>
                Add note
              </button>
            )}
            {has('wins') && (
              <button type="button" className="btn-ghost" onClick={() => setAddingWin(true)}>
                Log a win
              </button>
            )}
            {has('contributions') && (
              <button type="button" className="btn-ghost" onClick={() => setAddingContribution(true)}>
                Log activity
              </button>
            )}
            {has('people') && (
              <button type="button" className="btn-ghost" onClick={() => setAddingPerson(true)}>
                Add person
              </button>
            )}
            <button type="button" className="btn-primary" onClick={() => setAddingTask(true)}>
              Add task
            </button>
          </>
        }
      />

      <div className="mb-6 flex flex-wrap gap-4">
        <Counter label="Open" value={summary.openTaskCount} />
        <Counter label="Urgent" value={summary.urgentTaskCount} tone={summary.urgentTaskCount ? 'warn' : undefined} />
        <Counter label="Overdue" value={summary.overdueTaskCount} tone={summary.overdueTaskCount ? 'bad' : undefined} />
        {summary.peopleCount != null && <Counter label="People" value={summary.peopleCount} />}
        {summary.needsAttentionCount != null && (
          <Counter
            label="Need me"
            value={summary.needsAttentionCount}
            tone={summary.needsAttentionCount ? 'bad' : 'good'}
          />
        )}
        {summary.contributionPointsLast6Months != null && (
          <Counter
            label="Promotion points (6m)"
            value={summary.contributionPointsLast6Months}
            tone="good"
          />
        )}
        {summary.winCount != null && <Counter label="Wins logged" value={summary.winCount} />}
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Panel title="To do" description={`${open.length} open`}>
            {open.length === 0 ? (
              <EmptyState message="Nothing open. Enjoy it." />
            ) : (
              <ul className="divide-y divide-border">
                {open.map((task) => (
                  <TaskRow key={task.id} task={task} />
                ))}
              </ul>
            )}
          </Panel>

          {has('people') && (
            <Panel
              title="My people"
              description="Who needs something from me, and when."
            >
              {data.people.length === 0 ? (
                <EmptyState message="No direct reports added yet." />
              ) : (
                <ul className="divide-y divide-border">
                  {data.people.map((person) => (
                    <PersonRow key={person.id} person={person} />
                  ))}
                </ul>
              )}
            </Panel>
          )}

          {has('contributions') && (
            <Panel
              title="Perk-earning work"
              description="Interviews, referrals and staffing help all count towards promotion."
            >
              {data.contributions.length === 0 ? (
                <EmptyState message="Nothing logged. This is what promotion cases are made of." />
              ) : (
                <ul className="divide-y divide-border">
                  {data.contributions.map((contribution) => (
                    <li key={contribution.id} className="flex items-start justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm">{contribution.title}</p>
                          <Chip>{contribution.type.replace(/_/g, ' ')}</Chip>
                        </div>
                        <p className="text-xs text-ink-faint">
                          {formatDay(contribution.date)}
                          {contribution.outcome && ` · ${contribution.outcome}`}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="tabular text-sm text-emerald-400">+{contribution.points}</p>
                        <DeleteButton path={`/boards/contributions/${contribution.id}`} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}

          {has('wins') && (
            <Panel
              title="Evidence for reviews"
              description="Specific things you did, with who noticed. Worth its weight at review time."
            >
              {data.wins.length === 0 ? (
                <EmptyState message="Nothing logged yet. Future you will want this." />
              ) : (
                <ul className="divide-y divide-border">
                  {data.wins.map((win) => (
                    <li key={win.id} className="flex items-start justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="text-sm">{win.title}</p>
                        <p className="text-xs text-ink-faint">
                          {formatDay(win.date)}
                          {win.impact && ` · ${win.impact}`}
                          {win.witnesses.length > 0 && ` · noticed by ${win.witnesses.join(', ')}`}
                        </p>
                      </div>
                      <DeleteButton path={`/boards/wins/${win.id}`} />
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}
        </div>

        <div className="space-y-5">
          {has('notes') && (
            <Panel title="Notes" description={`${data.notes.length} saved`}>
              {data.notes.length === 0 ? (
                <EmptyState message="No notes yet." />
              ) : (
                <ul className="space-y-2">
                  {data.notes.map((note) => (
                    <li key={note.id} className="rounded-lg border border-border px-3 py-2">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-medium">
                          {note.pinned && '📌 '}
                          {note.title}
                        </p>
                        <DeleteButton path={`/boards/notes/${note.id}`} />
                      </div>
                      {note.body && (
                        <p className="mt-1 whitespace-pre-wrap text-xs text-ink-muted">{note.body}</p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}

          {done.length > 0 && (
            <Panel title="Done" description={`${done.length} finished`}>
              <ul className="space-y-1">
                {done.slice(0, 15).map((task) => (
                  <li key={task.id} className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate text-ink-faint line-through">{task.title}</span>
                    {task.completedAt && (
                      <span className="shrink-0 text-ink-faint">{formatDay(task.completedAt)}</span>
                    )}
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </div>

      <TaskModal open={addingTask} onClose={() => setAddingTask(false)} boardKey={boardKey} />
      <NoteModal open={addingNote} onClose={() => setAddingNote(false)} boardKey={boardKey} />
      <PersonModal open={addingPerson} onClose={() => setAddingPerson(false)} boardKey={boardKey} />
      <ContributionModal
        open={addingContribution}
        onClose={() => setAddingContribution(false)}
        boardKey={boardKey}
      />
      <WinModal open={addingWin} onClose={() => setAddingWin(false)} boardKey={boardKey} />
    </>
  );
}

function Counter({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'good' | 'warn' | 'bad';
}) {
  return (
    <div className="card px-4 py-3">
      <p
        className={clsx(
          'tabular text-lg font-semibold',
          tone === 'good' && 'text-emerald-400',
          tone === 'warn' && 'text-amber-400',
          tone === 'bad' && 'text-rose-400',
        )}
      >
        {value}
      </p>
      <p className="text-[11px] text-ink-faint">{label}</p>
    </div>
  );
}

function DeleteButton({ path }: { path: string }) {
  const { run, pending } = useAction();
  return (
    <button
      type="button"
      className="shrink-0 text-[11px] text-ink-faint hover:text-rose-400"
      disabled={pending}
      onClick={() => void run(() => api.delete(path))}
    >
      ✕
    </button>
  );
}

function TaskRow({ task }: { task: BoardTask }) {
  const { run, pending } = useAction();
  const meta = PRIORITY_META[task.priority] ?? PRIORITY_META[3];
  const overdue = task.dueDate && task.dueDate < new Date().toISOString().slice(0, 10);

  return (
    <li className="flex items-start justify-between gap-3 py-2.5">
      <div className="flex min-w-0 items-start gap-2.5">
        <input
          type="checkbox"
          className="mt-1"
          disabled={pending}
          checked={task.status === 'done'}
          onChange={(event) =>
            void run(() =>
              api.patch(`/boards/tasks/${task.id}`, {
                status: event.target.checked ? 'done' : 'todo',
              }),
            )
          }
        />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm">{task.title}</p>
            <Chip tone={meta.tone}>{meta.label}</Chip>
            {task.status === 'blocked' && <Chip tone="bad">blocked</Chip>}
            {task.status === 'in_progress' && <Chip tone="warn">in progress</Chip>}
            {task.impact && <Chip>{task.impact.replace(/_/g, ' ')}</Chip>}
          </div>
          {task.notes && <p className="mt-0.5 text-xs text-ink-faint">{task.notes}</p>}
          {task.dueDate && (
            <p className={clsx('mt-0.5 text-xs', overdue ? 'text-rose-400' : 'text-ink-faint')}>
              due {formatDay(task.dueDate)}
            </p>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Select
          className="w-auto py-1 text-xs"
          value={task.status}
          disabled={pending}
          onChange={(event) =>
            void run(() => api.patch(`/boards/tasks/${task.id}`, { status: event.target.value }))
          }
        >
          {TASK_STATUSES.map((option) => (
            <option key={option} value={option}>
              {option.replace(/_/g, ' ')}
            </option>
          ))}
        </Select>
        <DeleteButton path={`/boards/tasks/${task.id}`} />
      </div>
    </li>
  );
}

function PersonRow({ person }: { person: Person & { oneOnOneOverdue: boolean } }) {
  const { run, pending } = useAction();
  const meta = ATTENTION_META[person.attentionState] ?? ATTENTION_META['ok'];
  const today = new Date().toISOString().slice(0, 10);

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium">{person.name}</p>
            <Chip tone={meta.tone}>{meta.label}</Chip>
            {person.oneOnOneOverdue && <Chip tone="warn">1:1 overdue</Chip>}
          </div>
          <p className="mt-0.5 text-xs text-ink-faint">
            {[person.role, person.level, person.project].filter(Boolean).join(' · ') || 'no details'}
          </p>
          {person.attentionReason && (
            <p className="mt-1 text-xs text-amber-300">{person.attentionReason}</p>
          )}
          <p className="mt-1 text-xs text-ink-faint">
            {person.lastOneOnOne ? `last 1:1 ${formatDay(person.lastOneOnOne)}` : 'no 1:1 recorded'}
            {person.nextCheckIn && ` · next ${relativeDays(today, person.nextCheckIn)}`}
            {person.nextReviewDate && ` · review ${formatDay(person.nextReviewDate)}`}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Select
            className="w-auto py-1 text-xs"
            value={person.attentionState}
            disabled={pending}
            onChange={(event) =>
              void run(() =>
                api.patch(`/boards/people/${person.id}`, { attentionState: event.target.value }),
              )
            }
          >
            {ATTENTION_STATES.map((option) => (
              <option key={option} value={option}>
                {ATTENTION_META[option]?.label ?? option}
              </option>
            ))}
          </Select>
          <button
            type="button"
            className="text-[11px] text-sky-400 hover:underline"
            disabled={pending}
            onClick={() => void run(() => api.post(`/boards/people/${person.id}/one-on-one`, {}))}
          >
            had a 1:1
          </button>
          <DeleteButton path={`/boards/people/${person.id}`} />
        </div>
      </div>
    </li>
  );
}

// ------------------------------------------------------------------ modals

function TaskModal({
  open,
  onClose,
  boardKey,
}: {
  open: boolean;
  onClose: () => void;
  boardKey: string;
}) {
  const [form, setForm] = useState({ title: '', notes: '', priority: '3', dueDate: '', impact: '' });
  const { run, pending, error } = useAction();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a task"
      submitLabel="Add task"
      pending={pending}
      error={error}
      onSubmit={async () => {
        const ok = await run(() =>
          api.post(`/boards/${boardKey}/tasks`, {
            title: form.title,
            notes: form.notes || undefined,
            priority: Number(form.priority),
            dueDate: form.dueDate || undefined,
            impact: form.impact || undefined,
          }),
        );
        if (ok) {
          setForm({ title: '', notes: '', priority: '3', dueDate: '', impact: '' });
          onClose();
        }
      }}
    >
      <Field label="What needs doing">
        <Input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
      </Field>
      <Field label="Notes">
        <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Priority">
          <Select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
            <option value="1">Now</option>
            <option value="2">Soon</option>
            <option value="3">Normal</option>
            <option value="4">Someday</option>
          </Select>
        </Field>
        <Field label="Due">
          <Input
            type="date"
            value={form.dueDate}
            onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
          />
        </Field>
      </div>
      <Field label="Why it matters" hint="Used to sort by what moves the needle.">
        <Select value={form.impact} onChange={(e) => setForm({ ...form, impact: e.target.value })}>
          <option value="">Not sure</option>
          <option value="promotion">Promotion</option>
          <option value="performance_review">Performance review</option>
          <option value="revenue">Revenue</option>
          <option value="maintenance">Maintenance</option>
          <option value="learning">Learning</option>
        </Select>
      </Field>
    </Modal>
  );
}

function NoteModal({ open, onClose, boardKey }: { open: boolean; onClose: () => void; boardKey: string }) {
  const [form, setForm] = useState({ title: '', body: '', pinned: false });
  const { run, pending, error } = useAction();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a note"
      submitLabel="Save note"
      pending={pending}
      error={error}
      onSubmit={async () => {
        const ok = await run(() => api.post(`/boards/${boardKey}/notes`, form));
        if (ok) {
          setForm({ title: '', body: '', pinned: false });
          onClose();
        }
      }}
    >
      <Field label="Title">
        <Input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
      </Field>
      <Field label="Note">
        <Textarea rows={6} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
      </Field>
      <label className="flex items-center gap-2 text-sm text-ink-muted">
        <input
          type="checkbox"
          checked={form.pinned}
          onChange={(e) => setForm({ ...form, pinned: e.target.checked })}
        />
        Pin to the top
      </label>
    </Modal>
  );
}

function PersonModal({ open, onClose, boardKey }: { open: boolean; onClose: () => void; boardKey: string }) {
  const [form, setForm] = useState({
    name: '',
    role: '',
    level: '',
    project: '',
    attentionState: 'ok',
    attentionReason: '',
    nextCheckIn: '',
    oneOnOneCadenceDays: '14',
  });
  const { run, pending, error } = useAction();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a person"
      submitLabel="Add person"
      pending={pending}
      error={error}
      onSubmit={async () => {
        const ok = await run(() =>
          api.post(`/boards/${boardKey}/people`, {
            name: form.name,
            role: form.role || undefined,
            level: form.level || undefined,
            project: form.project || undefined,
            attentionState: form.attentionState,
            attentionReason: form.attentionReason || undefined,
            nextCheckIn: form.nextCheckIn || undefined,
            oneOnOneCadenceDays: Number(form.oneOnOneCadenceDays),
          }),
        );
        if (ok) onClose();
      }}
    >
      <Field label="Name">
        <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Role">
          <Input value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} />
        </Field>
        <Field label="Grade">
          <Input
            placeholder="A3"
            value={form.level}
            onChange={(e) => setForm({ ...form, level: e.target.value })}
          />
        </Field>
        <Field label="Project">
          <Input value={form.project} onChange={(e) => setForm({ ...form, project: e.target.value })} />
        </Field>
      </div>
      <Field label="How are they doing">
        <Select
          value={form.attentionState}
          onChange={(e) => setForm({ ...form, attentionState: e.target.value })}
        >
          {ATTENTION_STATES.map((option) => (
            <option key={option} value={option}>
              {ATTENTION_META[option]?.label ?? option}
            </option>
          ))}
        </Select>
      </Field>
      {form.attentionState !== 'ok' && (
        <Field label="Why" hint="What they need, so you remember before the next 1:1.">
          <Textarea
            rows={2}
            value={form.attentionReason}
            onChange={(e) => setForm({ ...form, attentionReason: e.target.value })}
          />
        </Field>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Next check-in">
          <Input
            type="date"
            value={form.nextCheckIn}
            onChange={(e) => setForm({ ...form, nextCheckIn: e.target.value })}
          />
        </Field>
        <Field label="1:1 every N days">
          <Input
            type="number"
            min="1"
            value={form.oneOnOneCadenceDays}
            onChange={(e) => setForm({ ...form, oneOnOneCadenceDays: e.target.value })}
          />
        </Field>
      </div>
    </Modal>
  );
}

function ContributionModal({
  open,
  onClose,
  boardKey,
}: {
  open: boolean;
  onClose: () => void;
  boardKey: string;
}) {
  const [form, setForm] = useState({ type: 'interview', title: '', outcome: '', date: '' });
  const { run, pending, error } = useAction();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Log perk-earning work"
      submitLabel="Log it"
      pending={pending}
      error={error}
      onSubmit={async () => {
        const ok = await run(() =>
          api.post(`/boards/${boardKey}/contributions`, {
            type: form.type,
            title: form.title,
            outcome: form.outcome || undefined,
            date: form.date || undefined,
          }),
        );
        if (ok) {
          setForm({ type: 'interview', title: '', outcome: '', date: '' });
          onClose();
        }
      }}
    >
      <p className="text-xs text-ink-muted">
        Points are assigned per activity type and add up over a rolling six months, matching the
        review cycle.
      </p>
      <Field label="What was it">
        <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
          {CONTRIBUTION_TYPES.map((option) => (
            <option key={option} value={option}>
              {option.replace(/_/g, ' ')}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Description">
        <Input
          required
          placeholder="Interviewed a senior React candidate"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
        />
      </Field>
      <Field label="Outcome">
        <Input
          placeholder="Passed to the next round"
          value={form.outcome}
          onChange={(e) => setForm({ ...form, outcome: e.target.value })}
        />
      </Field>
      <Field label="When" hint="Leave blank for today.">
        <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
      </Field>
    </Modal>
  );
}

function WinModal({ open, onClose, boardKey }: { open: boolean; onClose: () => void; boardKey: string }) {
  const [form, setForm] = useState({ title: '', impact: '', witnesses: '', date: '' });
  const { run, pending, error } = useAction();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Log a win"
      submitLabel="Log it"
      pending={pending}
      error={error}
      onSubmit={async () => {
        const ok = await run(() =>
          api.post(`/boards/${boardKey}/wins`, {
            title: form.title,
            impact: form.impact || undefined,
            witnesses: form.witnesses
              ? form.witnesses.split(',').map((name) => name.trim()).filter(Boolean)
              : undefined,
            date: form.date || undefined,
          }),
        );
        if (ok) {
          setForm({ title: '', impact: '', witnesses: '', date: '' });
          onClose();
        }
      }}
    >
      <p className="text-xs text-ink-muted">
        Write it down now, with a number if you can. At review time you will not remember.
      </p>
      <Field label="What you did">
        <Input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
      </Field>
      <Field label="What changed because of it" hint="A number here is worth a paragraph.">
        <Input
          placeholder="Cut the build from 11 to 4 minutes"
          value={form.impact}
          onChange={(e) => setForm({ ...form, impact: e.target.value })}
        />
      </Field>
      <Field label="Who noticed" hint="Comma separated.">
        <Input value={form.witnesses} onChange={(e) => setForm({ ...form, witnesses: e.target.value })} />
      </Field>
      <Field label="When" hint="Leave blank for today.">
        <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
      </Field>
    </Modal>
  );
}
