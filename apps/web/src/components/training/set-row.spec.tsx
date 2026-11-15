import { fireEvent, render, screen } from '@testing-library/react';
import { SetInput, fieldsFor, readFields } from './set-row';

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

describe('selecting a set number on focus (#32)', () => {
  const reps = { key: 'reps', label: 'Reps', aria: 'Reps', inputMode: 'numeric', placeholder: '0' } as const;
  const fields = fieldsFor('weight_reps', { reps: 12, type: 'working' }, 'kg');
  const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));

  it('selects the whole value when focused by keyboard, so typing replaces it', async () => {
    render(<SetInput column={reps} fields={fields} onChange={jest.fn()} />);
    const input = screen.getByLabelText('Reps') as HTMLInputElement;
    input.focus();
    await frame();
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 2]);
  });

  it('keeps the selection through the tap that focused it, and lets the next tap place the caret', async () => {
    render(<SetInput column={reps} fields={fields} onChange={jest.fn()} />);
    const input = screen.getByLabelText('Reps') as HTMLInputElement;
    fireEvent.pointerDown(input);
    input.focus();
    const first = fireEvent.pointerUp(input);
    expect(first).toBe(false); // the caret-placing default was prevented
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 2]);
    // Already focused: a second tap is the person's own and is left alone.
    fireEvent.pointerDown(input);
    expect(fireEvent.pointerUp(input)).toBe(true);
  });
});
