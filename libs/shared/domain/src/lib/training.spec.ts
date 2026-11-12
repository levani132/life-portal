import {
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
