'use client';

import { useState } from 'react';
import type { ActivityLevel, NutritionGoal, NutritionProfile, Sex } from '@life-portal/shared-types';
import { ACTIVITY_LEVELS, NUTRITION_GOALS, SEXES } from '@life-portal/shared-types';
import { ACTIVITY_LABELS, GOAL_PLAN } from '@life-portal/shared-domain';
import { api } from '../lib/api';
import { useAction } from '../lib/hooks';
import { Field, Input, Panel, Select } from './ui';

const WEEKDAYS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
];

/**
 * The profile: intent, not measurement. Weight and body fat are recorded as weigh-ins next door,
 * because a measurement has a date and this form does not.
 */
export function NutritionSettings({
  profile,
  onSaved,
}: {
  profile: NutritionProfile;
  onSaved?: () => void;
}) {
  const { run, pending, error } = useAction();

  const [sex, setSex] = useState<Sex | ''>(profile.sex ?? '');
  const [heightCm, setHeightCm] = useState(profile.heightCm ? String(profile.heightCm) : '');
  const [birthDate, setBirthDate] = useState(profile.birthDate ?? '');
  const [activityLevel, setActivityLevel] = useState<ActivityLevel>(profile.activityLevel);
  const [goal, setGoal] = useState<NutritionGoal>(profile.goal);
  const [basalRateKcal, setBasalRateKcal] = useState(
    profile.basalRateKcal ? String(profile.basalRateKcal) : '',
  );
  const [cheatDays, setCheatDays] = useState<number[]>(profile.cheatDays);
  const [dayStartHour, setDayStartHour] = useState(String(profile.dayStartHour));
  const [overrides, setOverrides] = useState({
    energyOverrideKcal: profile.energyOverrideKcal ? String(profile.energyOverrideKcal) : '',
    proteinOverrideG: profile.proteinOverrideG ? String(profile.proteinOverrideG) : '',
    fatOverrideG: profile.fatOverrideG ? String(profile.fatOverrideG) : '',
    carbOverrideG: profile.carbOverrideG ? String(profile.carbOverrideG) : '',
  });

  /*
   * There is deliberately **no effect re-seeding this form from `profile`**.
   *
   * There used to be, and it silently ate input: `profile.cheatDays` is a fresh array on every
   * fetch, so the effect fired on any refetch — including the one triggered by recording a
   * weigh-in — and reset the sex dropdown to the server's value, which was still "not set".
   * Saving then sent "not set" and the targets stayed blocked with no visible reason.
   *
   * Local state owns the form once it is mounted. When the *server's* profile really changes, the
   * page remounts this component (`key={profile.updatedAt}`), which re-seeds it from props.
   */

  /**
   * `null`, not `undefined`, for an emptied field: `JSON.stringify` drops `undefined`, so the API
   * would never hear that an override was removed. The service turns an explicit null into
   * `$unset`.
   */
  const int = (value: string): number | null => {
    if (value.trim() === '') return null;
    const parsed = Math.round(Number(value));
    return Number.isFinite(parsed) ? parsed : null;
  };

  const save = () =>
    void run(async () => {
      await api.put('/nutrition/profile', {
        sex: sex || null,
        heightCm: int(heightCm),
        birthDate: birthDate || null,
        activityLevel,
        goal,
        basalRateKcal: int(basalRateKcal),
        cheatDays,
        dayStartHour: int(dayStartHour) ?? 4,
        energyOverrideKcal: int(overrides.energyOverrideKcal),
        proteinOverrideG: int(overrides.proteinOverrideG),
        fatOverrideG: int(overrides.fatOverrideG),
        carbOverrideG: int(overrides.carbOverrideG),
      });
    }).then((ok) => {
      if (ok) onSaved?.();
    });

  const toggleCheatDay = (value: number) =>
    setCheatDays((current) =>
      current.includes(value) ? current.filter((day) => day !== value) : [...current, value].sort(),
    );

  return (
    <Panel
      title="Your numbers"
      description="What the targets are worked out from. Everything here is editable, and every figure it produces says where it came from."
      actions={
        <button type="button" className="btn-primary" onClick={save} disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </button>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Sex" hint="the equations differ">
            <Select value={sex} onChange={(event) => setSex(event.target.value as Sex | '')}>
              <option value="">not set</option>
              {SEXES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Height (cm)">
            <Input
              inputMode="numeric"
              value={heightCm}
              onChange={(event) => setHeightCm(event.target.value)}
              placeholder="180"
            />
          </Field>
          <Field label="Date of birth" hint="age drives the calorie equation">
            <Input
              type="date"
              value={birthDate}
              onChange={(event) => setBirthDate(event.target.value)}
            />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="How active are you?" hint={ACTIVITY_LABELS[activityLevel]}>
            <Select
              value={activityLevel}
              onChange={(event) => setActivityLevel(event.target.value as ActivityLevel)}
            >
              {ACTIVITY_LEVELS.map((option) => (
                <option key={option} value={option}>
                  {option} — {ACTIVITY_LABELS[option]}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="What are you after?"
            hint={`${GOAL_PLAN[goal].energyFactor === 1 ? 'maintenance' : `${Math.round((GOAL_PLAN[goal].energyFactor - 1) * 100)}% of maintenance`}`}
          >
            <Select value={goal} onChange={(event) => setGoal(event.target.value as NutritionGoal)}>
              {NUTRITION_GOALS.map((option) => (
                <option key={option} value={option}>
                  {GOAL_PLAN[option].label}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Measured basal rate (kcal)"
            hint="optional — if you have had it measured, it beats every equation"
          >
            <Input
              inputMode="numeric"
              value={basalRateKcal}
              onChange={(event) => setBasalRateKcal(event.target.value)}
              placeholder="worked out for you"
            />
          </Field>
          <Field
            label="A new day starts at"
            hint="a meal before this hour counts towards the day before"
          >
            <Select value={dayStartHour} onChange={(event) => setDayStartHour(event.target.value)}>
              {[0, 1, 2, 3, 4, 5, 6].map((hour) => (
                <option key={hour} value={hour}>
                  {String(hour).padStart(2, '0')}:00
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <fieldset>
          <legend className="label">Cheat days</legend>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAYS.map((weekday) => (
              <button
                key={weekday.value}
                type="button"
                onClick={() => toggleCheatDay(weekday.value)}
                aria-pressed={cheatDays.includes(weekday.value)}
                className={
                  cheatDays.includes(weekday.value)
                    ? 'chip border-lime-500/50 bg-lime-500/15 text-lime-200'
                    : 'chip border-border text-ink-muted hover:text-ink'
                }
              >
                {weekday.label}
              </button>
            ))}
          </div>
        </fieldset>

        <details className="rounded-lg border border-border px-3 py-2">
          <summary className="cursor-pointer text-xs uppercase tracking-wide text-ink-faint">
            Override the targets by hand
          </summary>
          <p className="mt-2 text-xs text-ink-faint">
            For when a coach — or you — disagrees with the model. An override is shown as recorded
            rather than estimated, and the modelled figure stays visible beside it.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-4">
            <Field label="Calories">
              <Input
                inputMode="numeric"
                value={overrides.energyOverrideKcal}
                onChange={(event) =>
                  setOverrides({ ...overrides, energyOverrideKcal: event.target.value })
                }
              />
            </Field>
            <Field label="Protein (g)">
              <Input
                inputMode="numeric"
                value={overrides.proteinOverrideG}
                onChange={(event) =>
                  setOverrides({ ...overrides, proteinOverrideG: event.target.value })
                }
              />
            </Field>
            <Field label="Carbs (g)">
              <Input
                inputMode="numeric"
                value={overrides.carbOverrideG}
                onChange={(event) =>
                  setOverrides({ ...overrides, carbOverrideG: event.target.value })
                }
              />
            </Field>
            <Field label="Fat (g)">
              <Input
                inputMode="numeric"
                value={overrides.fatOverrideG}
                onChange={(event) =>
                  setOverrides({ ...overrides, fatOverrideG: event.target.value })
                }
              />
            </Field>
          </div>
        </details>

        {error && (
          <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
            {error}
          </p>
        )}
      </div>
    </Panel>
  );
}
