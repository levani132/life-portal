import { fieldsFor, readFields } from './set-row';

jest.mock('../../lib/api', () => ({ api: {}, ApiError: class extends Error {} }));

const blank = fieldsFor('bodyweight_reps', undefined, 'kg');

describe('the signed body-weight load', () => {
  it('reads a negative number as assistance and a positive one as added weight', () => {
    expect(readFields('bodyweight_reps', { ...blank, weight: '-20', reps: '8' }, 'kg')).toEqual({
      type: 'working',
      reps: 8,
      assistGrams: 20000,
    });
    expect(readFields('bodyweight_reps', { ...blank, weight: '7.5', reps: '5' }, 'kg')).toEqual({
      type: 'working',
      reps: 5,
      weightGrams: 7500,
    });
  });

  it('reads an empty, zero or sign-only field as plain body weight', () => {
    for (const weight of ['', '0', '-']) {
      expect(readFields('bodyweight_reps', { ...blank, weight, reps: '10' }, 'kg')).toEqual({ type: 'working', reps: 10 });
    }
  });

  it('shows a stored assisted set with a minus, and round-trips it', () => {
    const fields = fieldsFor('bodyweight_reps', { reps: 6, assistGrams: 15000, type: 'working' }, 'kg');
    expect(fields.weight).toBe('-15');
    expect(readFields('bodyweight_reps', fields, 'kg').assistGrams).toBe(15000);
  });

  it('takes assistance on an assisted machine as a magnitude, with or without the minus', () => {
    const assisted = fieldsFor('assisted_reps', undefined, 'kg');
    expect(readFields('assisted_reps', { ...assisted, assist: '-20', reps: '8' }, 'kg').assistGrams).toBe(20000);
    expect(readFields('assisted_reps', { ...assisted, assist: '20', reps: '8' }, 'kg').assistGrams).toBe(20000);
  });
});
