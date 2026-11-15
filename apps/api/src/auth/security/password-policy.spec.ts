import { passwordProblem } from './password-policy';

describe('passwordProblem', () => {
  it('accepts a reasonable password', () => {
    expect(passwordProblem('correct-horse-27')).toBeNull();
  });

  it('counts characters for the minimum and UTF-8 bytes for the maximum', () => {
    expect(passwordProblem('short')).toBe('too_short');
    // 10 Georgian letters = 10 characters (30 bytes): long enough.
    expect(passwordProblem('ქართულიენა')).toBeNull();
    // 25 Georgian letters = 75 bytes: over bcrypt's 72 even though it is only 25 characters.
    expect(passwordProblem('ქართულიენაქართულიენაქართუ')).toBe('too_long');
    expect(passwordProblem('a'.repeat(30) + 'bcd' + 'x'.repeat(39))).toBeNull(); // exactly 72 bytes
    expect(passwordProblem('a'.repeat(30) + 'bcd' + 'x'.repeat(40))).toBe('too_long');
  });

  it('refuses common, repetitive and email passwords', () => {
    expect(passwordProblem('Password123')).toBe('common');
    expect(passwordProblem('aaaaaaaaaaaa')).toBe('repetitive');
    expect(passwordProblem('abababababab')).toBe('repetitive');
    expect(passwordProblem('Me@Example.com', 'me@example.com')).toBe('is_email');
  });
});
