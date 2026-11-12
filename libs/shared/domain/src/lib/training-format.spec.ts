import { displayToGrams, formatRecordValue, formatWeight, gramsToDisplay } from './training-format';

describe('weight units (spec 020 US5, research R9)', () => {
  it('stores 225 lb once as whole grams and shows it back as 225 lb', () => {
    const grams = displayToGrams(225, 'lb');
    expect(grams).toBe(102_058);
    expect(formatWeight(grams, 'lb')).toBe('225 lb');
  });

  it('shows the same stored grams in kg after switching, without changing them', () => {
    expect(gramsToDisplay(102_058, 'kg')).toBe(102.06);
    expect(formatWeight(102_058, 'kg')).toBe('102.06 kg');
    expect(formatWeight(100_000, 'lb')).toBe('220.46 lb');
  });

  it('defaults to kg and keeps plate fractions', () => {
    expect(displayToGrams(101.25)).toBe(101_250);
    expect(formatWeight(101_250)).toBe('101.25 kg');
    expect(displayToGrams(0, 'lb')).toBe(0);
  });

  it('formats record values in the chosen unit', () => {
    const base = { setId: 's', sessionId: 'x', day: '2026-11-12' };
    expect(formatRecordValue({ ...base, kind: 'heaviest', value: 102_058 }, 'lb')).toBe('225 lb');
    expect(formatRecordValue({ ...base, kind: 'most_reps', value: 10, loadGrams: 60_000 }, 'lb')).toBe('10 reps at 132.28 lb');
    expect(formatRecordValue({ ...base, kind: 'fastest_pace', value: 280 }, 'lb')).toBe('4:40 /km');
  });
});
