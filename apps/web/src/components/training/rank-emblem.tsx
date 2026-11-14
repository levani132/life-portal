'use client';

import clsx from 'clsx';
import { useId } from 'react';
import { RANK_DIVISIONS, type RankDivision, type RankTier } from '@life-portal/shared-types';

/**
 * The strength-rank emblems (#13), as signed off on the concept sheet. Display only: nothing
 * about them is stored or scored.
 *
 * Each tier has its own silhouette and glyph, so tiers differ without colour (a circle, a diamond,
 * a heater shield, a hexagon, a laurel shield, a winged octagon, a crowned shield, a sun); the
 * material rises from stone to metals to gems with gold trim. The division is the number of filled
 * pips (III one, II two, I three), with empty slots drawn as outlines so it reads in greyscale.
 * The emblem is decorative unless `label` is given: the rank is always also written as text.
 *
 * Motion: only Legend's rays turn, only where `animate` is set (a large, single emblem), and never
 * under `prefers-reduced-motion` (`motion-safe:`).
 */

type Shape = 'circle' | 'diamond' | 'heater' | 'hex' | 'kite' | 'oct' | 'crowned' | 'medal';
type Glyph = 'seed' | 'compass' | 'bolt' | 'star' | 'chevrons' | 'spark' | 'ringedStar' | 'flame';

interface TierLook {
  shape: Shape;
  glyph: Glyph;
  /** Gradient stops, light to dark. */
  material: [string, string, string];
  trim: string;
  ink: string;
  laurel?: string;
  wings?: string;
  crown?: boolean;
  rays?: boolean;
}

export const TIER_LOOK: Record<RankTier, TierLook> = {
  Initiate: { shape: 'circle', glyph: 'seed', material: ['#e2e8f0', '#94a3b8', '#475569'], trim: '#64748b', ink: '#ffffff' },
  Explorer: { shape: 'diamond', glyph: 'compass', material: ['#f3c597', '#c27a3f', '#7a4418'], trim: '#8f5426', ink: '#fff7ed' },
  Challenger: { shape: 'heater', glyph: 'bolt', material: ['#ffffff', '#b8c2cf', '#6b7788'], trim: '#6b7788', ink: '#334155' },
  Achiever: { shape: 'hex', glyph: 'star', material: ['#fde68a', '#eab308', '#a16207'], trim: '#a16207', ink: '#713f12' },
  Veteran: { shape: 'kite', glyph: 'chevrons', material: ['#6ee7b7', '#059669', '#064e3b'], trim: '#047857', ink: '#ecfdf5', laurel: '#c9a43e' },
  Elite: { shape: 'oct', glyph: 'spark', material: ['#93c5fd', '#2563eb', '#1e3a8a'], trim: '#1e40af', ink: '#eff6ff', wings: '#d7dee8' },
  Master: { shape: 'crowned', glyph: 'ringedStar', material: ['#d8b4fe', '#9333ea', '#4c1d95'], trim: '#d99a0b', ink: '#fdf4ff', laurel: '#d99a0b', crown: true },
  Legend: { shape: 'medal', glyph: 'flame', material: ['#4b5563', '#1f2937', '#030712'], trim: '#f59e0b', ink: '#fbbf24', rays: true, crown: true },
};

function starPath(cx: number, cy: number, outer: number, inner: number, points: number): string {
  const out: string[] = [];
  for (let k = 0; k < points * 2; k++) {
    const r = k % 2 ? inner : outer;
    const a = ((-90 + (k * 180) / points) * Math.PI) / 180;
    out.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return `M${out.join('L')}Z`;
}

const SHAPES: Record<Shape, string> = {
  circle: 'M32 8a22 22 0 1 1 0 44a22 22 0 1 1 0-44Z',
  diamond: 'M32 5L57 30L32 55L7 30Z',
  heater: 'M11 9H53V29C53 43 44 51 32 56C20 51 11 43 11 29Z',
  hex: 'M32 5L54 17.5V42.5L32 55L10 42.5V17.5Z',
  kite: 'M32 6L51 12V30C51 43 43 51 32 56C21 51 13 43 13 30V12Z',
  oct: 'M23 7H41L53 19V41L41 53H23L11 41V19Z',
  crowned: 'M12 13H52V31C52 44 43 51 32 56C21 51 12 44 12 31Z',
  medal: 'M32 10a20 20 0 1 1 0 40a20 20 0 1 1 0-40Z',
};

const STAR = starPath(32, 30, 12, 5, 5);
const SPARK = starPath(32, 30, 14, 4, 4);
const RINGED_STAR = starPath(32, 33, 8.5, 3.6, 5);
const RAYS = starPath(32, 30, 32, 22, 12);
const WING = 'M14 22C6 17 0 21-1 28C3 27 7 28 9 30C3 31 0 35 1 40C5 37 9 36 12 37C8 39 7 43 8 46C11 43 13 42 15 42Z';
const CROWN = 'M19 15L16 1L25 8L32-4L39 8L48 1L45 15Z';

/** Laurel leaves along both sides of the lower rim. */
const LAUREL = [-1, 1].flatMap((side) =>
  Array.from({ length: 5 }, (_, k) => {
    const deg = side < 0 ? 112 + k * 23 : 68 - k * 23;
    const a = (deg * Math.PI) / 180;
    return { x: +(32 + 27 * Math.cos(a)).toFixed(1), y: +(33 + 26 * Math.sin(a)).toFixed(1), rotate: deg + 90 + side * 28 };
  }),
);

function GlyphMark({ glyph, ink }: { glyph: Glyph; ink: string }) {
  switch (glyph) {
    case 'seed':
      return <circle cx="32" cy="30" r="5.5" fill={ink} />;
    case 'compass':
      return (
        <g fill={ink}>
          <path d="M32 14L37.5 30L32 46L26.5 30Z" />
          <circle cx="32" cy="30" r="2.2" fillOpacity={0.5} />
        </g>
      );
    case 'bolt':
      return <path d="M35 15L23 33H31L28 46L41 27H33Z" fill={ink} />;
    case 'star':
      return <path d={STAR} fill={ink} />;
    case 'chevrons':
      return <path d="M21 22L32 30L43 22M21 32L32 40L43 32" fill="none" stroke={ink} strokeWidth={4.5} strokeLinecap="round" strokeLinejoin="round" />;
    case 'spark':
      return <path d={SPARK} fill={ink} />;
    case 'ringedStar':
      return (
        <g>
          <circle cx="32" cy="33" r="12" fill="none" stroke={ink} strokeWidth={2.2} />
          <path d={RINGED_STAR} fill={ink} />
        </g>
      );
    case 'flame':
      return <path d="M32 13C38 21 42 25 42 32C42 38 37 43 32 43C27 43 22 38 22 32C22 27 25 24 27 21C28 25 30 27 32 27C31 22 30 18 32 13Z" fill={ink} />;
  }
}

export function RankEmblem({
  tier,
  division,
  size = 40,
  locked = false,
  muted = false,
  animate = false,
  label,
  className,
}: {
  tier: RankTier;
  division: RankDivision;
  /** Width in px; the height follows (the pips sit under the emblem). */
  size?: number;
  /** Not reached: greyed, faded and marked with a lock. */
  locked?: boolean;
  /** Reached but not current (an inactive highest rank): greyed without the lock. */
  muted?: boolean;
  /** Turn Legend's rays, slowly, where motion is allowed. Only for one large emblem. */
  animate?: boolean;
  /** Makes the emblem an image with this name; without it the emblem is decorative. */
  label?: string;
  className?: string;
}) {
  const look = TIER_LOOK[tier];
  const id = useId().replace(/:/g, '');
  const filled = RANK_DIVISIONS.indexOf(division) + 1;
  const body = SHAPES[look.shape];
  return (
    <svg
      viewBox="-2 -6 68 86"
      width={size}
      height={Math.round((size * 86) / 68)}
      className={clsx('shrink-0 overflow-visible text-ink-faint', (locked || muted) && 'grayscale', locked ? 'opacity-50' : muted && 'opacity-60', className)}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
      data-tier={tier}
      data-division={division}
    >
      <defs>
        <linearGradient id={`${id}m`} x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0" stopColor={look.material[0]} />
          <stop offset="0.5" stopColor={look.material[1]} />
          <stop offset="1" stopColor={look.material[2]} />
        </linearGradient>
        <linearGradient id={`${id}s`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity={0.55} />
          <stop offset="0.45" stopColor="#fff" stopOpacity={0} />
        </linearGradient>
        <linearGradient id={`${id}g`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fef3c7" />
          <stop offset="0.5" stopColor="#f59e0b" />
          <stop offset="1" stopColor="#b45309" />
        </linearGradient>
      </defs>
      <g>
        {look.rays && (
          <g
            style={{ transformOrigin: '32px 30px' }}
            className={clsx(animate && 'motion-safe:animate-[spin_40s_linear_infinite]')}
            data-testid={animate ? 'legend-rays' : undefined}
          >
            <path d={RAYS} fill={`url(#${id}g)`} stroke={look.trim} strokeWidth={1} strokeLinejoin="round" />
          </g>
        )}
        {look.laurel &&
          LAUREL.map((leaf, i) => (
            <ellipse key={i} cx={leaf.x} cy={leaf.y} rx={5.6} ry={2.3} transform={`rotate(${leaf.rotate} ${leaf.x} ${leaf.y})`} fill={look.laurel} />
          ))}
        {look.wings && (
          <>
            <path d={WING} fill={look.wings} stroke={look.trim} strokeWidth={1.5} strokeLinejoin="round" />
            <path d={WING} transform="translate(64 0) scale(-1 1)" fill={look.wings} stroke={look.trim} strokeWidth={1.5} strokeLinejoin="round" />
          </>
        )}
        <path d={body} fill={`url(#${id}m)`} stroke={look.trim} strokeWidth={2.6} strokeLinejoin="round" />
        <path d={body} fill={`url(#${id}s)`} />
        <path d={body} transform="translate(32 31) scale(.8) translate(-32 -31)" fill="none" stroke="#fff" strokeOpacity={0.4} strokeWidth={1.6} strokeLinejoin="round" />
        <GlyphMark glyph={look.glyph} ink={look.ink} />
        {look.crown && (
          <>
            <path d={CROWN} fill={`url(#${id}g)`} stroke="#92400e" strokeWidth={1.3} strokeLinejoin="round" />
            <circle cx="32" cy="-3" r="2" fill="#fff" fillOpacity={0.45} />
            <circle cx="16" cy="1.5" r="1.6" fill="#fff" fillOpacity={0.45} />
            <circle cx="48" cy="1.5" r="1.6" fill="#fff" fillOpacity={0.45} />
          </>
        )}
      </g>
      {[0, 1, 2].map((k) => {
        const x = 22 + k * 10;
        const on = k < filled;
        return (
          <path
            key={k}
            d={`M${x} 66L${x + 4} 70L${x} 74L${x - 4} 70Z`}
            fill={on && !locked ? look.material[1] : 'none'}
            stroke={on && !locked ? look.trim : 'currentColor'}
            strokeWidth={1.4}
            opacity={on && !locked ? 1 : 0.5}
            data-pip={on ? 'on' : 'off'}
          />
        );
      })}
      {locked && (
        <g transform="translate(44 40)">
          <circle cx="8" cy="8" r="9" fill="#334155" stroke="#fff" strokeWidth={1.5} />
          <rect x="4" y="7" width="8" height="6" rx="1" fill="#fff" />
          <path d="M5.5 7V5.5a2.5 2.5 0 0 1 5 0V7" fill="none" stroke="#fff" strokeWidth={1.6} />
        </g>
      )}
    </svg>
  );
}
