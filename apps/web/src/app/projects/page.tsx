'use client';
import Link from 'next/link';
import { useState } from 'react';
import type { Board } from '@life-portal/shared-types';
import { AppShell, PageHeader } from '../../components/app-shell';
import { ErrorNote, Field, Input, Spinner } from '../../components/ui';
import { api } from '../../lib/api';
import { useAction, useApi } from '../../lib/hooks';
export default function ProjectsPage() {
  return (
    <AppShell>
      <Projects />
    </AppShell>
  );
}
function Projects() {
  const { data, error, isLoading, mutate } = useApi<{ boards: Board[] }>(
    '/boards',
  );
  const [name, setName] = useState('');
  const action = useAction();
  if (isLoading) return <Spinner />;
  if (error) return <ErrorNote message={(error as Error).message} />;
  const projects = data?.boards.filter((board) => board.key !== 'epam') ?? [];
  return (
    <>
      <PageHeader
        title="Projects"
        subtitle="A place for your tasks and ideas."
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {projects.map((board) => (
          <Link
            key={board.id}
            href={`/boards/${board.key}`}
            className="card p-5 hover:border-violet-400/40"
          >
            <h2 className="font-medium">{board.name}</h2>
            <p className="mt-2 text-sm text-ink-muted">
              {board.description ?? 'Open tasks and notes'}
            </p>
          </Link>
        ))}
      </div>
      {projects.length === 0 && (
        <p className="mb-4 text-ink-muted">
          Start with a project you’d like to move forward.
        </p>
      )}
      <form
        className="card mt-6 max-w-lg space-y-4 p-5"
        onSubmit={(event) => {
          event.preventDefault();
          void action.run(async () => {
            await api.post('/boards', {
              name: name.trim(),
              key: `project-${crypto.randomUUID().slice(0, 8)}`,
              kind: 'side_project',
              features: ['tasks', 'notes'],
            });
            setName('');
            await mutate();
          });
        }}
      >
        <h2 className="font-medium">New project</h2>
        <Field label="Project name">
          <Input
            required
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        {action.error && <ErrorNote message={action.error} />}
        <button
          className="btn btn-primary"
          disabled={action.pending || !name.trim()}
        >
          {action.pending ? 'Creating…' : 'Create project'}
        </button>
      </form>
    </>
  );
}
