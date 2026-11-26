'use client';
import type { PortalState, TrainingProfile } from '@life-portal/shared-types';
import { api } from '../lib/api';
import { revalidate, useAction, useApi } from '../lib/hooks';
import { ErrorNote, Spinner } from './ui';

/**
 * Spec 046: what Training shows on your portal, each its own switch. The audience is Training's,
 * chosen above. Body weight is never shown, whatever is on.
 */
export function TrainingSharingControls() {
  const portal = useApi<PortalState>('/portal');
  const profile = useApi<TrainingProfile>(portal.data?.access.training ? '/training/profile' : null);
  const action = useAction();
  if (!portal.data?.access.training) return null;
  if (profile.error) return <ErrorNote message="Couldn't load Training sharing settings." />;
  if (!profile.data) return <Spinner />;
  const current = profile.data;
  return (
    <section className="card mt-5 space-y-4 p-5">
      <h2 className="font-semibold">Training on your portal</h2>
      <fieldset disabled={action.pending} className="space-y-3">
        {(
          [
            { key: 'shareWorkouts', label: 'Workouts: this week, the week streak and recent workouts' },
            { key: 'shareRecords', label: 'Personal records' },
            { key: 'shareLevel', label: 'Level' },
            { key: 'shareRanks', label: 'Ranks on your lifts' },
          ] as const
        ).map(({ key, label }) => (
          <label key={key} className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              className="h-5 w-5 shrink-0 accent-[rgb(var(--accent))]"
              checked={current[key] ?? false}
              onChange={(event) =>
                void action.run(
                  async () => {
                    await api.put('/training/profile', { [key]: event.target.checked });
                    await revalidate('/training/profile');
                    await revalidate('/social');
                  },
                  { revalidate: false },
                )
              }
            />
            {label}
          </label>
        ))}
      </fieldset>
      {portal.data.moduleVisibility.training === 'private' && (
        <p className="text-xs text-warning">Your Training audience is Only me. Choose Friends or Everyone above for these to show.</p>
      )}
      {action.error && <ErrorNote message={action.error} />}
      <p className="text-xs text-ink-faint">Switches save at once. Your body weight is never shown, and ranks show only their tier.</p>
    </section>
  );
}
