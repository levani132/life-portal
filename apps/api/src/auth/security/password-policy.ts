/**
 * The password policy (issue #27). Applied wherever a password is *set*: registration, change and
 * reset. Signing in never checks it, so an existing password keeps working.
 *
 * - At least 10 characters (counted as characters, so "ქართული" counts as 7).
 * - At most 72 bytes of UTF-8. bcrypt ignores everything after byte 72, so a longer password
 *   would silently be a shorter one. A Georgian letter is 3 bytes, so that is 24 of them.
 * - Not a well-known password, not mostly one repeated character, and not the email address.
 */
export const PASSWORD_MIN_CHARS = 10;
export const PASSWORD_MAX_BYTES = 72;

// Common passwords of 10+ characters (shorter ones already fail the length rule). Lowercased.
const COMMON = new Set([
  '1234567890', '0123456789', '0987654321', '12345678910', '123456789a', 'a123456789',
  '1q2w3e4r5t', '1q2w3e4r5t6y', 'q1w2e3r4t5', 'qwertyuiop', 'qwerty1234', 'qwerty12345',
  'qwerty123456', '1qaz2wsx3edc', 'zaq12wsxcde3', 'asdfghjkl1', 'asdfghjkl;', 'zxcvbnm123',
  'password12', 'password123', 'password1234', 'password12345', 'password!1', 'passw0rd123',
  'p@ssw0rd123', 'p@ssword123', 'iloveyou12', 'iloveyou123', 'football123', 'baseball123',
  'superman123', 'princess123', 'sunshine123', 'welcome123', 'welcome1234', 'letmein123',
  'monkey12345', 'dragon12345', 'changeme123', 'administrator', 'admin12345', 'admin123456',
  'abcdefghij', 'abcdefghijk', 'abc1234567', 'abcd123456', 'abcde12345', 'qazwsxedcrfv',
  'trustno1234', 'starwars123', 'whatever123', 'computer123', 'internet123', 'samsung123',
  'liverpool123', 'chelsea123', 'arsenal123', 'barcelona10', 'tbilisi123', 'georgia123',
  'lifeportal', 'lifeportal1', 'lifeportal123',
]);

export type PasswordProblem = 'too_short' | 'too_long' | 'common' | 'repetitive' | 'is_email';

export const PASSWORD_MESSAGES: Record<PasswordProblem, string> = {
  too_short: `Use at least ${PASSWORD_MIN_CHARS} characters — this guards your financial data.`,
  too_long: 'That password is too long. Use up to 72 bytes (about 24 Georgian letters or 72 Latin ones).',
  common: 'That password is too common. Choose something less guessable.',
  repetitive: 'That password repeats too few characters. Choose something less guessable.',
  is_email: "Don't use your email address as your password.",
};

export function passwordProblem(password: string, email?: string): PasswordProblem | null {
  if ([...password].length < PASSWORD_MIN_CHARS) return 'too_short';
  if (Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES) return 'too_long';
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) return 'common';
  if (new Set(lower).size < 4) return 'repetitive';
  if (email && lower === email.trim().toLowerCase()) return 'is_email';
  return null;
}
