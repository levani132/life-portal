import {
  CATALOGUE_EQUIPMENT_SUFFIX,
  catalogueName,
  legacyMachineCase,
  weekSummary,
  bestOneRepMax,
  bestSetOf,
  bodyWeightOn,
  effectiveLoadGrams,
  estimateOneRepMax,
  oneRepMaxFor,
  paceSecondsPerKm,
  personalRecords,
  sessionVolumeGrams,
  setVolumeGrams,
  type ProgressSet,
  catalogueEquipment,
  catalogueMeasure,
  catalogueMuscles,
  isStaleSession,
  isValidRpe,
  normaliseSearch,
  sessionDurationSeconds,
  setFieldsFor,
  validateSetValues,
} from './training';

describe('setFieldsFor', () => {
  it('requires weight and reps for weighted exercises', () => {
    expect(setFieldsFor('weight_reps')).toEqual({
      allowed: ['reps', 'weightGrams'],
      required: ['reps', 'weightGrams'],
    });
  });

  it('allows added load on bodyweight reps but does not require it', () => {
    const rule = setFieldsFor('bodyweight_reps');
    expect(rule.allowed).toContain('weightGrams');
    expect(rule.required).toEqual(['reps']);
  });

  it('requires assistance on assisted reps and never a weight', () => {
    const rule = setFieldsFor('assisted_reps');
    expect(rule.required).toEqual(['reps', 'assistGrams']);
    expect(rule.allowed).not.toContain('weightGrams');
  });

  it('requires only time for duration, with optional load', () => {
    expect(setFieldsFor('duration')).toEqual({
      allowed: ['durationSeconds', 'weightGrams'],
      required: ['durationSeconds'],
    });
  });

  it('requires distance and time for cardio', () => {
    expect(setFieldsFor('distance_duration').required).toEqual([
      'distanceMeters',
      'durationSeconds',
    ]);
  });
});

describe('validateSetValues', () => {
  it('accepts a complete weighted set', () => {
    expect(validateSetValues('weight_reps', { reps: 8, weightGrams: 80_000 })).toBeNull();
  });

  it('accepts an empty bar (0 g) but not 0 reps', () => {
    expect(validateSetValues('weight_reps', { reps: 5, weightGrams: 0 })).toBeNull();
    expect(validateSetValues('weight_reps', { reps: 0, weightGrams: 20_000 })).toBe(
      'Reps must be between 1 and 1000.',
    );
  });

  it('reports a missing required field', () => {
    expect(validateSetValues('weight_reps', { reps: 8 })).toBe('Weight is required.');
    expect(validateSetValues('distance_duration', { distanceMeters: 2000 })).toBe(
      'Time is required.',
    );
  });

  it('rejects a field the measure does not use', () => {
    expect(validateSetValues('distance_duration', {
      distanceMeters: 2000,
      durationSeconds: 600,
      reps: 3,
    })).toBe('Reps does not apply to this exercise.');
    expect(validateSetValues('assisted_reps', { reps: 8, assistGrams: 20_000, weightGrams: 1 }))
      .toBe('Weight does not apply to this exercise.');
  });

  it('treats null as not given', () => {
    expect(
      validateSetValues('bodyweight_reps', { reps: 10, weightGrams: null as unknown as number }),
    ).toBeNull();
  });

  it('rejects fractions, negatives and implausible values', () => {
    expect(validateSetValues('weight_reps', { reps: 8, weightGrams: 80_000.5 })).toBe(
      'Weight must be a whole number.',
    );
    expect(validateSetValues('weight_reps', { reps: 8, weightGrams: -1 })).toBe(
      'Weight must be between 0 and 1000000.',
    );
    expect(validateSetValues('weight_reps', { reps: 1, weightGrams: 1_000_001 })).toBe(
      'Weight must be between 0 and 1000000.',
    );
    expect(validateSetValues('duration', { durationSeconds: 86_401 })).toBe(
      'Time must be between 1 and 86400.',
    );
  });
});

describe('isValidRpe', () => {
  it('accepts 1–10 in half steps only', () => {
    expect(isValidRpe(1)).toBe(true);
    expect(isValidRpe(8.5)).toBe(true);
    expect(isValidRpe(10)).toBe(true);
    expect(isValidRpe(0.5)).toBe(false);
    expect(isValidRpe(10.5)).toBe(false);
    expect(isValidRpe(7.25)).toBe(false);
  });
});

describe('sessionDurationSeconds', () => {
  const startedAt = '2026-11-12T18:00:00.000Z';

  it('runs to the end when finished', () => {
    expect(
      sessionDurationSeconds({ startedAt, endedAt: '2026-11-12T19:05:30.000Z' }),
    ).toBe(3930);
  });

  it('runs to the last set while open, never to now', () => {
    expect(
      sessionDurationSeconds({ startedAt, lastSetAt: '2026-11-12T18:40:00.000Z' }),
    ).toBe(2400);
    expect(sessionDurationSeconds({ startedAt })).toBe(0);
  });
});

describe('isStaleSession', () => {
  const startedAt = '2026-11-12T08:00:00.000Z';
  const at = (iso: string) => Date.parse(iso);

  it('is stale after 12 hours without activity', () => {
    expect(isStaleSession({ status: 'open', startedAt }, at('2026-11-12T20:00:01.000Z'))).toBe(
      true,
    );
    expect(isStaleSession({ status: 'open', startedAt }, at('2026-11-12T20:00:00.000Z'))).toBe(
      false,
    );
  });

  it('counts from the last set, and never for a finished session', () => {
    expect(
      isStaleSession(
        { status: 'open', startedAt, lastSetAt: '2026-11-12T19:00:00.000Z' },
        at('2026-11-12T22:00:00.000Z'),
      ),
    ).toBe(false);
    expect(
      isStaleSession({ status: 'finished', startedAt }, at('2026-11-20T00:00:00.000Z')),
    ).toBe(false);
  });
});

describe('normaliseSearch', () => {
  it('folds case, accents and punctuation', () => {
    expect(normaliseSearch("Arnold's  Dumbbell-Press")).toBe('arnold s dumbbell press');
    expect(normaliseSearch('Crème Brûlée')).toBe('creme brulee');
  });

  it('keeps non-Latin letters', () => {
    expect(normaliseSearch('ჯდომა!')).toBe('ჯდომა');
  });
});

describe('catalogue mapping', () => {
  it('names the equipment where the dataset name does not, keeping the old name as an alias (#14)', () => {
    expect(catalogueName({ id: 'Butterfly', name: 'Butterfly' })).toEqual({ name: 'Butterfly (Machine)', aliases: ['Butterfly'] });
    expect(catalogueName({ id: 'Pallof_Press', name: 'Pallof Press ' })).toEqual({ name: 'Pallof Press (Cable)', aliases: ['Pallof Press'] });
    expect(catalogueName({ id: 'Barbell_Squat', name: 'Barbell Squat' })).toEqual({ name: 'Barbell Squat', aliases: [] });
    for (const suffix of Object.values(CATALOGUE_EQUIPMENT_SUFFIX)) expect(['Machine', 'Cable']).toContain(suffix);
  });

  it('tells a machine exercise from a free-weight one logged on a machine (#14)', () => {
    expect(legacyMachineCase('machine')).toBe('same_exercise');
    expect(legacyMachineCase('cable')).toBe('same_exercise');
    expect(legacyMachineCase('smith_machine')).toBe('same_exercise');
    expect(legacyMachineCase('barbell')).toBe('free_weight_on_machine');
    expect(legacyMachineCase('bodyweight')).toBe('free_weight_on_machine');
  });

  it('maps cardio to distance and time', () => {
    expect(catalogueMeasure({ category: 'cardio', equipment: 'machine', force: null })).toBe(
      'distance_duration',
    );
  });

  it('maps stretches and static holds to time', () => {
    expect(catalogueMeasure({ category: 'stretching', equipment: null, force: 'static' })).toBe(
      'duration',
    );
    expect(catalogueMeasure({ category: 'strength', equipment: 'body only', force: 'static' }))
      .toBe('duration');
  });

  it('maps equipment-free movements to bodyweight reps', () => {
    expect(catalogueMeasure({ category: 'strength', equipment: 'body only', force: 'pull' }))
      .toBe('bodyweight_reps');
    expect(catalogueMeasure({ category: 'plyometrics', equipment: null, force: 'push' })).toBe(
      'bodyweight_reps',
    );
  });

  it('maps everything else to weight × reps', () => {
    expect(catalogueMeasure({ category: 'powerlifting', equipment: 'barbell', force: 'push' }))
      .toBe('weight_reps');
    expect(catalogueMeasure({ category: 'strength', equipment: 'other', force: 'pull' })).toBe(
      'weight_reps',
    );
  });

  it('maps equipment names, falling back to other', () => {
    expect(catalogueEquipment({ equipment: 'e-z curl bar' })).toBe('ez_bar');
    expect(catalogueEquipment({ equipment: 'kettlebells' })).toBe('kettlebell');
    expect(catalogueEquipment({ equipment: null })).toBe('other');
    expect(catalogueEquipment({ equipment: 'hovercraft' })).toBe('other');
  });

  it('maps muscle names and drops unknown ones', () => {
    expect(catalogueMuscles(['middle back', 'lats', 'lats', 'tail'])).toEqual([
      'middle_back',
      'lats',
    ]);
  });
});

// ------------------------------------------------------------------ progress (US3)

describe('estimateOneRepMax (Epley)', () => {
  it('is the load itself for a single rep', () => {
    expect(estimateOneRepMax(100_000, 1)).toBe(100_000);
  });
  it('applies load × (1 + reps / 30), rounded once to whole grams', () => {
    expect(estimateOneRepMax(100_000, 5)).toBe(116_667);
    expect(estimateOneRepMax(85_000, 6)).toBe(102_000);
  });
  it('allows 12 reps and refuses 13, zero reps or no load', () => {
    expect(estimateOneRepMax(60_000, 12)).toBe(84_000);
    expect(estimateOneRepMax(60_000, 13)).toBeUndefined();
    expect(estimateOneRepMax(60_000, 0)).toBeUndefined();
    expect(estimateOneRepMax(0, 5)).toBeUndefined();
  });
});

describe('bodyWeightOn', () => {
  const weighIns = [
    { day: '2026-11-01', weightGrams: 80_000 },
    { day: '2026-11-08', weightGrams: 79_000 },
  ];
  it('takes the latest weigh-in on or before the day', () => {
    expect(bodyWeightOn(weighIns, '2026-11-08')?.weightGrams).toBe(79_000);
    expect(bodyWeightOn(weighIns, '2026-11-07')?.weightGrams).toBe(80_000);
  });
  it('has nothing before the first weigh-in', () => {
    expect(bodyWeightOn(weighIns, '2026-10-31')).toBeUndefined();
  });
});

describe('effectiveLoadGrams', () => {
  const body = { day: '2026-11-01', weightGrams: 80_000 };
  it('uses the recorded weight for weight × reps', () => {
    expect(effectiveLoadGrams('weight_reps', { reps: 5, weightGrams: 100_000 }, body)).toEqual({ grams: 100_000 });
  });
  it('adds added load to body weight, and says which weigh-in', () => {
    expect(effectiveLoadGrams('bodyweight_reps', { reps: 8 }, body)).toEqual({ grams: 80_000, bodyWeightDay: '2026-11-01' });
    expect(effectiveLoadGrams('bodyweight_reps', { reps: 8, weightGrams: 10_000 }, body)?.grams).toBe(90_000);
  });
  it('subtracts assistance, never below zero', () => {
    expect(effectiveLoadGrams('assisted_reps', { reps: 8, assistGrams: 30_000 }, body)?.grams).toBe(50_000);
    expect(effectiveLoadGrams('assisted_reps', { reps: 8, assistGrams: 90_000 }, body)?.grams).toBe(0);
  });
  it('has no load without a weigh-in, or for timed and distance work', () => {
    expect(effectiveLoadGrams('bodyweight_reps', { reps: 8 })).toBeUndefined();
    expect(effectiveLoadGrams('assisted_reps', { reps: 8, assistGrams: 30_000 })).toBeUndefined();
    expect(effectiveLoadGrams('duration', { durationSeconds: 60, weightGrams: 20_000 }, body)).toBeUndefined();
    expect(effectiveLoadGrams('distance_duration', { distanceMeters: 1000, durationSeconds: 300 }, body)).toBeUndefined();
  });
});

describe('volume and pace', () => {
  it('is load × reps, and nothing without a load', () => {
    expect(setVolumeGrams({ grams: 80_000 }, 8)).toBe(640_000);
    expect(setVolumeGrams(undefined, 8)).toBeUndefined();
  });
  it('gives pace in whole seconds per kilometre', () => {
    expect(paceSecondsPerKm({ distanceMeters: 2000, durationSeconds: 500 })).toBe(250);
    expect(paceSecondsPerKm({ distanceMeters: 2000 })).toBeUndefined();
  });
});

let seq = 0;
const s = (sessionId: string, values: Partial<ProgressSet> = {}): ProgressSet => ({
  id: `set-${++seq}`,
  sessionId,
  day: `2026-11-${sessionId.padStart(2, '0')}`,
  type: 'working',
  ...values,
});

describe('personalRecords', () => {
  it('marks nothing in the first workout, then marks sets that beat every earlier one', () => {
    const sets = [
      s('1', { reps: 8, weightGrams: 80_000 }),
      s('1', { reps: 8, weightGrams: 85_000 }),
      s('2', { reps: 8, weightGrams: 85_000 }),
      s('2', { reps: 5, weightGrams: 90_000 }),
    ];
    const { marks, best } = personalRecords('weight_reps', sets);
    expect(marks.get(sets[0].id)).toBeUndefined();
    expect(marks.get(sets[1].id)).toBeUndefined();
    expect(marks.get(sets[2].id)).toBeUndefined(); // equals, does not beat
    // 90 × 5: heaviest; Epley 105 000 vs 85 × 8 = 107 667, so not a 1RM record.
    expect(marks.get(sets[3].id)).toEqual(['heaviest']);
    expect(best.find((r) => r.kind === 'heaviest')).toMatchObject({ value: 90_000, setId: sets[3].id, day: '2026-11-02' });
    expect(best.find((r) => r.kind === 'best_1rm')).toMatchObject({ value: 107_667, setId: sets[1].id });
  });

  it('counts reps only against sets at the same load or heavier', () => {
    const sets = [
      s('1', { reps: 12, weightGrams: 60_000 }),
      s('1', { reps: 8, weightGrams: 80_000 }),
      s('2', { reps: 10, weightGrams: 80_000 }),
      s('2', { reps: 11, weightGrams: 60_000 }),
    ];
    const { marks, best } = personalRecords('weight_reps', sets);
    expect(marks.get(sets[2].id)).toContain('most_reps');
    expect(marks.get(sets[3].id)).toBeUndefined();
    expect(best.find((r) => r.kind === 'most_reps')).toMatchObject({ value: 12, loadGrams: 60_000 });
  });

  it('ignores warm-ups', () => {
    const sets = [
      s('1', { reps: 5, weightGrams: 100_000 }),
      s('2', { type: 'warmup', reps: 5, weightGrams: 120_000 }),
    ];
    const { marks, best } = personalRecords('weight_reps', sets);
    expect(marks.size).toBe(0);
    expect(best.find((r) => r.kind === 'heaviest')?.value).toBe(100_000);
  });

  it('falls back to the true best when the record set is gone', () => {
    const sets = [
      s('1', { reps: 5, weightGrams: 100_000 }),
      s('2', { reps: 5, weightGrams: 110_000 }),
      s('3', { reps: 5, weightGrams: 105_000 }),
    ];
    const without = personalRecords('weight_reps', sets.filter((set) => set !== sets[1]));
    expect(without.best.find((r) => r.kind === 'heaviest')).toMatchObject({ value: 105_000, setId: sets[2].id });
    expect(without.marks.get(sets[2].id)).toContain('heaviest');
  });

  it('needs a weigh-in for bodyweight loads, and labels them with it', () => {
    const body = { day: '2026-11-01', weightGrams: 80_000 };
    const sets = [s('1', { reps: 10 }), s('2', { reps: 12 }), s('3', { reps: 8, weightGrams: 10_000, body })];
    const { marks, best } = personalRecords('bodyweight_reps', sets);
    expect(marks.get(sets[1].id)).toEqual(['most_reps']);
    expect(best.find((r) => r.kind === 'heaviest')).toMatchObject({ value: 90_000, bodyWeightDay: '2026-11-01' });
    expect(best.find((r) => r.kind === 'most_reps')?.value).toBe(12);
  });

  it('finds the longest distance and the fastest pace', () => {
    const sets = [
      s('1', { distanceMeters: 5000, durationSeconds: 1500 }),
      s('2', { distanceMeters: 3000, durationSeconds: 840 }),
    ];
    const { marks, best } = personalRecords('distance_duration', sets);
    expect(marks.get(sets[1].id)).toEqual(['fastest_pace']);
    expect(best.find((r) => r.kind === 'longest_distance')?.value).toBe(5000);
    expect(best.find((r) => r.kind === 'fastest_pace')?.value).toBe(280);
  });
});

describe('session figures', () => {
  const sets = [
    s('9', { type: 'warmup', reps: 10, weightGrams: 60_000 }),
    s('9', { reps: 8, weightGrams: 80_000 }),
    s('9', { reps: 5, weightGrams: 90_000 }),
  ];
  it('picks the set with the best estimate', () => {
    expect(bestSetOf('weight_reps', sets)).toBe(sets[2].id);
  });
  it('sums working volume only', () => {
    expect(sessionVolumeGrams('weight_reps', sets)).toBe(640_000 + 450_000);
  });
  it('labels the session estimate with its formula and set', () => {
    expect(bestOneRepMax('weight_reps', sets)).toEqual({
      valueGrams: 105_000,
      basis: { formula: 'epley', fromSetId: sets[2].id, weightGrams: 90_000, reps: 5 },
    });
    expect(oneRepMaxFor('weight_reps', sets[0])).toBeUndefined();
  });
});

describe('weekSummary', () => {
  // 2026-11-12 is a Thursday; the week began on Monday 2026-11-09.
  const sessions = [
    { id: 'a', day: '2026-11-08', status: 'finished' as const, durationSeconds: 3000 },
    { id: 'b', day: '2026-11-09', status: 'finished' as const, durationSeconds: 3600 },
    { id: 'c', day: '2026-11-12', status: 'open' as const, durationSeconds: 600 },
  ];
  const record = { kind: 'heaviest' as const, value: 100_000, setId: 's', sessionId: 'b', day: '2026-11-09', exerciseName: 'Bench' };

  it('counts this Monday-based week only, and offers the open session', () => {
    const summary = weekSummary({ sessions, records: [], today: '2026-11-12' });
    expect(summary).toMatchObject({ workoutsThisWeek: 2, secondsThisWeek: 4200, openSessionId: 'c', daysSinceLast: 0 });
  });

  it('shows the newest record within 14 days instead of days since the last workout', () => {
    const older = { ...record, day: '2026-11-01', setId: 'old' };
    const summary = weekSummary({ sessions, records: [older, record], today: '2026-11-12' });
    expect(summary.latestRecord?.setId).toBe('s');
    expect(summary.daysSinceLast).toBeUndefined();
  });

  it('drops a record older than 14 days and counts days since the last workout', () => {
    const summary = weekSummary({
      sessions: sessions.slice(0, 2),
      records: [{ ...record, day: '2026-10-29' }],
      today: '2026-11-12',
    });
    expect(summary.latestRecord).toBeUndefined();
    expect(summary.daysSinceLast).toBe(3);
    expect(summary.workoutsThisWeek).toBe(1);
  });

  it('is empty for someone who never trained', () => {
    expect(weekSummary({ sessions: [], records: [], today: '2026-11-12' })).toEqual({ workoutsThisWeek: 0, secondsThisWeek: 0 });
  });

  it('starts the week on Monday even when today is Sunday', () => {
    const summary = weekSummary({ sessions, records: [], today: '2026-11-15' });
    expect(summary.workoutsThisWeek).toBe(2);
  });
});

describe('body weight with a signed external load (#5)', () => {
  const body = { day: '2026-11-01', weightGrams: 80_000 };

  it('accepts added weight, assistance, zero added load or neither, never both', () => {
    expect(validateSetValues('bodyweight_reps', { reps: 5, weightGrams: 20_000 })).toBeNull();
    expect(validateSetValues('bodyweight_reps', { reps: 5, assistGrams: 25_000 })).toBeNull();
    expect(validateSetValues('bodyweight_reps', { reps: 5, weightGrams: 0 })).toBeNull();
    expect(validateSetValues('bodyweight_reps', { reps: 5 })).toBeNull();
    expect(validateSetValues('bodyweight_reps', { reps: 5, weightGrams: 0, assistGrams: 10_000 })).toBeNull();
    expect(validateSetValues('bodyweight_reps', { reps: 5, weightGrams: 5_000, assistGrams: 10_000 })).toBe(
      'Use added weight or assistance, not both.',
    );
  });

  it('adds weight, subtracts assistance, and never goes below zero', () => {
    expect(effectiveLoadGrams('bodyweight_reps', { reps: 5, weightGrams: 20_000 }, body)?.grams).toBe(100_000);
    expect(effectiveLoadGrams('bodyweight_reps', { reps: 5, assistGrams: 25_000 }, body)?.grams).toBe(55_000);
    expect(effectiveLoadGrams('bodyweight_reps', { reps: 5, weightGrams: 0 }, body)?.grams).toBe(80_000);
    expect(effectiveLoadGrams('bodyweight_reps', { reps: 5 }, body)?.grams).toBe(80_000);
    expect(effectiveLoadGrams('bodyweight_reps', { reps: 5, assistGrams: 90_000 }, body)?.grams).toBe(0);
    expect(effectiveLoadGrams('bodyweight_reps', { reps: 5, weightGrams: 20_000 }, undefined)).toBeUndefined();
  });

  it('leaves weight × reps exactly as it was: the weight is the load, body weight is not added', () => {
    expect(effectiveLoadGrams('weight_reps', { reps: 5, weightGrams: 20_000 }, body)).toEqual({ grams: 20_000 });
  });

  it('measures the weighted pull-ups, dips and suspended rows as body weight, and only those "other" entries', () => {
    const other = { category: 'strength', equipment: 'other', force: 'pull' };
    for (const id of ['Weighted_Pull_Ups', 'Parallel_Bar_Dip', 'Ring_Dips', 'Muscle_Up', 'Suspended_Row', 'Dips_-_Chest_Version']) {
      expect([id, catalogueMeasure({ ...other, id })]).toEqual([id, 'bodyweight_reps']);
    }
    expect(catalogueMeasure({ ...other, id: 'Sled_Row' })).toBe('weight_reps');
    expect(catalogueMeasure({ ...other, id: 'Some_Other_Thing' })).toBe('weight_reps');
    expect(catalogueMeasure(other)).toBe('weight_reps');
  });
});
