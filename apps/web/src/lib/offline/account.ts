import type { User } from '@life-portal/shared-types';

/**
 * Which account this device last signed in as, so the app can open offline (spec 027). Only
 * the fields the shell needs to render. Written on every confirmed sign-in, removed on logout.
 * Tokens already live in localStorage (`lib/api.ts`); this adds the person's own id and name.
 */
const KEY = 'lp.offline.user';

export function rememberUser(user: User): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ id: user.id, name: user.name, email: user.email, roles: user.roles }));
  } catch {
    // Storage blocked: the app simply cannot open offline.
  }
}

export function rememberedUser(): User | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<User>;
    if (typeof parsed.id !== 'string' || typeof parsed.name !== 'string') return null;
    return {
      id: parsed.id,
      name: parsed.name,
      email: typeof parsed.email === 'string' ? parsed.email : '',
      roles: Array.isArray(parsed.roles) ? parsed.roles : [],
    } as User;
  } catch {
    return null;
  }
}

export function forgetUser(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // nothing to do
  }
}
