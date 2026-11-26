import { nextPath } from './next-path';

describe('nextPath', () => {
  it('keeps a path inside the app and refuses anything else', () => {
    expect(nextPath('?next=%2F%40ana')).toBe('/@ana');
    expect(nextPath('')).toBe('/');
    expect(nextPath('?next=https%3A%2F%2Fevil.example')).toBe('/');
    expect(nextPath('?next=%2F%2Fevil.example')).toBe('/');
    expect(nextPath('?next=%2F%5Cevil.example')).toBe('/');
  });
});
