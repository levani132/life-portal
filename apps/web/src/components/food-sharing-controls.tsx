'use client';
import type { NutritionProfile, PortalState } from '@life-portal/shared-types';
import { api } from '../lib/api';
import { revalidate, useAction, useApi } from '../lib/hooks';
import { ErrorNote, Spinner } from './ui';
export function FoodSharingControls() {
  const portal = useApi<PortalState>('/portal');
  const profile = useApi<{ profile: NutritionProfile }>(
    portal.data?.access.nutrition ? '/nutrition/profile' : null,
  );
  const action = useAction();
  if (!portal.data?.access.nutrition) return null;
  if (profile.error)
    return <ErrorNote message="Couldn't load Food sharing settings." />;
  if (!profile.data) return <Spinner />;
  const current = profile.data.profile;
  return (
    <section className="card mt-5 space-y-4 p-5">
      <h2 className="font-semibold">Food details on your shared profile</h2>
      <p className="text-sm text-ink-muted">
        Choose your Food audience above, then choose which details they can see.
        Diary sharing shows logged foods, portions and meal nutrition, including
        past days. It doesn’t publish posts to Wall.
      </p>
      <fieldset disabled={action.pending} className="space-y-3">
        {(
          [
            { key: 'shareMeals', label: 'Share daily meal totals' },
            {
              key: 'shareDiary',
              label: 'Share foods and portions in my daily diary',
            },
            { key: 'shareTargets', label: 'Share nutrition targets' },
            { key: 'shareWeight', label: 'Share weight and body metrics' },
          ] as const
        ).map(({ key, label }) => (
          <label key={key} className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={current[key] ?? false}
              onChange={(e) =>
                void action.run(
                  async () => {
                    await api.put('/nutrition/profile', {
                      [key]: e.target.checked,
                    });
                    await revalidate('/nutrition');
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
      {portal.data.moduleVisibility.nutrition === 'private' && (
        <p className="text-xs text-amber-300">
          Your Food audience is Only me. Save Friends or Everyone above to make
          enabled details visible to that audience.
        </p>
      )}
      {action.error && <ErrorNote message={action.error} />}
      <p className="text-xs text-ink-faint">
        Detail switches save immediately. Private notes are never included.
      </p>
    </section>
  );
}
