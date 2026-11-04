import type { Audience } from '@life-portal/shared-types';
import { macroShares } from './post-media';

/**
 * Whether the viewer may turn a post into an image to share outside the app. An image cannot be
 * recalled and carries no audience, so only your own posts and public ones qualify: a friend's
 * friends-only post would otherwise leave the circle its author chose.
 */
export function canShareImage(input: { own: boolean; audience: Audience }): boolean {
  return input.own || input.audience === 'public';
}

export interface RingArc {
  key: 'protein' | 'carbs' | 'fat';
  /** Fractions of the full circle, clockwise from 12 o'clock. */
  start: number;
  end: number;
}

/**
 * The calorie ring split by where the calories come from, as arcs. A small gap separates the
 * parts when there is more than one, the same as the app's `MacroRings`. Empty parts are left out.
 */
export function ringArcs(
  macros: { proteinMg: number; carbMg: number; fatMg: number },
  gap = 0.008,
): RingArc[] {
  const shares = macroShares(macros);
  const parts = (['protein', 'carbs', 'fat'] as const).filter((key) => shares[key] > 0);
  const spacing = parts.length > 1 ? gap : 0;
  let at = 0;
  return parts.map((key) => {
    const arc = { key, start: at, end: at + Math.max(0, shares[key] - spacing) };
    at += shares[key];
    return arc;
  });
}

export type ShareTarget = 'whatsapp' | 'messenger' | 'facebook' | 'x';

/**
 * Web share links for apps that accept one. Only the post's link (and a short text) is sent; the
 * receiving app then reads the public preview, which is generic unless the post is public.
 * Messenger's link scheme works only where the Messenger app is installed (phones).
 */
export function shareTargetUrl(target: ShareTarget, url: string, text: string): string {
  const u = encodeURIComponent(url);
  switch (target) {
    case 'whatsapp':
      return `https://wa.me/?text=${encodeURIComponent(text ? `${text} ${url}` : url)}`;
    case 'messenger':
      return `fb-messenger://share/?link=${u}`;
    case 'facebook':
      return `https://www.facebook.com/sharer/sharer.php?u=${u}`;
    case 'x':
      return `https://x.com/intent/post?url=${u}${text ? `&text=${encodeURIComponent(text)}` : ''}`;
  }
}

/** The one-line summary used by previews and share text, e.g. "520 kcal · P 18g · C 70g · F 16g". */
export function macroLine(macros?: {
  energyKcal: number;
  proteinG: number;
  carbG: number;
  fatG: number;
}): string {
  if (!macros) return '';
  const g = (value: number) => `${Math.round(value)}g`;
  return `${Math.round(macros.energyKcal).toLocaleString('en-US')} kcal · P ${g(macros.proteinG)} · C ${g(macros.carbG)} · F ${g(macros.fatG)}`;
}
