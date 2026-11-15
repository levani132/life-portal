import type { Muscle } from '@life-portal/shared-types';
import { exerciseGroup, type TrainingGroup } from '../../lib/training-colors';

/**
 * Muscle figures (issue #30 follow-up, signed off on the concept sheets): close-up anatomical
 * panels (chest, back, flexed arm, abs, hips, thighs front and back, calves) drawn as separate
 * muscle shapes. The muscles an exercise targets are lit; the rest of the panel is dimmed.
 * Display only, derived from `primaryMuscles`: nothing about a figure is stored.
 *
 * Our own drawings. A part is `[id, path]`; an id starting with `_` is context that is never lit.
 * With `mid`, each path is the left half and is mirrored about that x.
 */
interface Panel {
  box: string;
  mid?: number;
  parts: [string, string][];
}

const DELT = 'M13.6 9C9.4 8.8 5.6 11.2 4.6 15.4C4.2 17.4 4.4 19.6 5.2 21.4C6.6 18.6 9.2 16.6 12.4 16C13.6 13.8 14 11.4 13.6 9Z';
const ARM_STUB = 'M5.2 21.8C6.6 19 9.2 17 12.2 16.6C12.2 19.6 12.8 22 13.8 24C13.4 26.6 12.6 29 11.6 31H5.4C4.6 28 4.6 24.8 5.2 21.8Z';
const PANELS: Record<string, Panel> = {
  torsoFront: { box: '0 0 48 40', mid: 24, parts: [
    ['neck', 'M21.2 2.6H24V9.6C22.6 9.6 21.4 9.1 20.6 8.3Z'],
    ['_trap', 'M20.9 4.8C19.8 7 17 8.4 13.6 9C16 9.6 18.6 9.8 20.8 9.6Z'],
    ['shoulders', DELT],
    ['chest', 'M24 10C22 9.6 16.6 9.4 13.9 9.6C14.2 11.8 13.7 14.2 12.6 16.2C12.4 19.4 14 22.2 16.8 23.2C19.6 24 22.4 23.4 24 21.6Z'],
    ['_arm', ARM_STUB],
    ['_side', 'M13.2 22C14.4 23.2 15.6 23.8 16.6 24C16.8 28 17 33 17.4 37.4H15.6C14.4 32.8 13.6 27.2 13.2 22Z'],
    ['_abs', 'M17.6 24.4C19.8 24.8 22 24.6 24 23.2V28H17.9Z'],
    ['_abs', 'M17.9 28.6H24V32.6H18.2Z'],
    ['_abs', 'M18.2 33.2H24V37.4H18.6Z'],
  ] },
  torsoBack: { box: '4 0 92 92', mid: 50, parts: [
    ['neck', 'M44 1H50V7H43Z'],
    ['traps', 'M42.6 8.6H50V48L46.6 40C43.6 32 37.6 26 29 23L27 19.4C34 18 40 14.6 42.6 8.6Z'],
    ['shoulders', 'M26 19.8C17 19.4 10 24.6 8 33C7.2 37 7.6 41.6 9.4 45.4C12.4 39.6 17.6 35.6 24 34.4C26.6 30 27.6 24.6 26 19.8Z'],
    ['middle_back', 'M28.4 22.4C36 25.6 41.6 31 44.6 39L46 44C39 43.6 32 41 25.6 36.4C27.4 32 28.6 27 28.4 22.4Z'],
    ['lats', 'M24.6 38C31.4 43 39 46 47 46.6L50 50.6V82C44 80 39 76 35.6 70C30.6 61 26.4 49.6 24.6 38Z'],
    ['lower_back', 'M50 84V92H38C37.4 86 36.8 80 36 74.6C39.6 79.6 44.4 82.8 50 84Z'],
    ['_side', 'M27.4 54.6C29.6 61 32 67 34.8 72C35.6 78.6 36.2 85.6 36.6 92H31.4C29.6 80 28 67 27.4 54.6Z'],
    ['triceps', 'M9.6 46.6C12.6 40.6 17.6 36.8 23.4 35.6C23.4 42 24.6 48 26.6 53C25.6 59 24 64.6 22 69H10C8 62 8 54 9.6 46.6Z'],
  ] },
  arm: { box: '2 0 98 82', parts: [
    ['shoulders', 'M70 30C78 22 92 24 97 36V62C91 62 85 58 81 52C80 43 76 35 70 30Z'],
    ['biceps', 'M36 46C38 32 49 24 60 25C65 25.4 68.6 27.6 70.6 31C75 37 78 44 79 52C66 46 50 44.6 36 46Z'],
    ['triceps', 'M33 50C48 48 66 50 80 56C83 61 89 65 96 66C86 76 64 80 46 75C38 72.6 31.6 67 28.6 60C29.6 56 31 53 33 50Z'],
    ['forearms', 'M10 58C8 44 11 28 18 18L25 20C25.6 32 24 46 20.6 62.6C16.6 62.4 12.8 60.8 10 58Z'],
    ['forearms', 'M27.4 20.6L33 22C35 30 35.6 39 34.4 47C31 51 28 56 26.4 62.4L23.2 62.8C26.4 47 28 32.6 27.4 20.6Z'],
    ['_fist', 'M17.6 16.4C15 10 18.4 3.6 25 2.4C31.6 1.2 38 4.4 39.2 10C40 15 37 19.6 33.4 21Z'],
  ] },
  abs: { box: '2 0 36 42', mid: 20, parts: [
    ['_pec', 'M20 2V6.4C16.6 8 12.6 7.6 9.6 5.4C10 4.2 10.6 3 11.4 2Z'],
    ['_oblique', 'M9.4 6.2C11.2 7.4 13.2 8 15 7.9C13.9 9.2 13.6 11 13.7 13L13.6 25.6C14.4 30.6 16 35.4 18.6 39C14 36.6 10.4 32.4 9.6 27C8.6 20 8.6 12.8 9.4 6.2Z'],
    ['abdominals', 'M20 7.2V12.6H14.6C14.4 10.6 14.8 8.8 15.8 7.8C17.2 7.9 18.8 7.7 20 7.2Z'],
    ['abdominals', 'M14.6 13.4H20V18.6H14.4Z'],
    ['abdominals', 'M14.4 19.4H20V24.8H14.6Z'],
    ['abdominals', 'M14.6 25.6H20V40C17.6 37 15.6 31.6 14.6 25.6Z'],
  ] },
  hipsBack: { box: '2 0 96 100', mid: 50, parts: [
    ['lower_back', 'M17 2H50V14C38 14 26 11 15.4 6Z'],
    ['abductors', 'M14.4 8C24 13 36 16 47 16.4C40 20 30 22 20 22C16 22 12.6 21.4 10.4 20.4C11 16 12.4 12 14.4 8Z'],
    ['glutes', 'M48.6 18.4V62C44 68 34 70.6 24 68.4C14 66 8 58 8.6 46C9 36 9.4 28 10.4 22.6C14 24 19 24.4 24 24C33 23.4 42 21.4 48.6 18.4Z'],
    ['hamstrings', 'M9.6 60C13 66 19 70 26 71V98H12C9.4 86 8.6 72 9.6 60Z'],
    ['hamstrings', 'M28 71.2C36 71.4 43.6 69 48.4 64.6V98H28Z'],
  ] },
  thighsFront: { box: '2 0 96 100', mid: 50, parts: [
    ['abductors', 'M8.6 2H20C19.6 10 17.6 19 14 27C10.4 24 8 19 7 13C7 9 7.6 5.4 8.6 2Z'],
    ['adductors', 'M36 2H49V30C46.6 36 44 41 41.6 44.6C41.6 30 39.6 15 36 2Z'],
    ['quadriceps', 'M22.4 2H33.4C37 14 39 30 38.6 46C38.2 58 36 69 32.6 77H25.6C22 67 20.4 55 20.8 43C21.2 28 21.6 14 22.4 2Z'],
    ['quadriceps', 'M13.2 29.6C15.4 26 17.6 20 19.4 12C19 24 18.4 34 18.2 44C18 56 19.8 68 23.2 77.4C16 71 9.6 58 7 43C6 34 6 24 7.2 16.6C8.4 22 10.6 26.6 13.2 29.6Z'],
    ['quadriceps', 'M41.2 47.4C43.6 43.6 46.4 38.6 49 32C49.4 47 47.6 62 43.6 73C41.6 77.4 38.4 79.6 35 78.6C38.4 70.6 40.8 60 41.2 47.4Z'],
    ['_knee', 'M25.4 80H33C35.4 82 36 86 34.4 89.4C32.6 91.6 27.4 91.6 25.4 89.4C23.4 86 23.6 82 25.4 80Z'],
    ['_shin', 'M16.6 80C19 84 21.6 88 22.8 92.6L22 98H15.6C14.6 92 15 85.6 16.6 80Z'],
    ['_shin', 'M37 81C39.6 80.6 42 78.6 43.6 76C43.6 84 42 92 39.6 98H34.6C35 94 36 90.6 37 87Z'],
  ] },
  thighsBack: { box: '2 0 96 100', mid: 50, parts: [
    ['glutes', 'M9 2H49V13C40 20 22 20 8 12C8 8 8.4 5 9 2Z'],
    ['_outer', 'M7.4 14.5C10 16.4 12.6 17.8 15 18.6C12.6 34 13 56 17 80L14.6 82C8.6 62 4.6 36 7.4 14.5Z'],
    ['hamstrings', 'M16.6 19.2C20.6 20.2 24.6 20.6 28 20.4C30.6 36 30 54 26.4 68C25 73 23.6 78 22.8 83L18.6 80.6C14.6 58 14.4 36 16.6 19.2Z'],
    ['hamstrings', 'M29.8 20.2C34 19.8 38.4 18.6 42 16.8C43 34 40.6 54 35.4 70C34 75 32.6 79.6 31.6 83.6L27.2 82C28 77 29.2 72 30.4 67C33 52 32.6 36 29.8 20.2Z'],
    ['adductors', 'M43.6 16C45.6 15 47.4 14 49 13V40C46.6 48 43.6 56 40 63C42.6 48 44.2 32 43.6 16Z'],
    ['calves', 'M16.4 84C19 86.6 22 87.6 24.6 87.4V98H15.4C15 93 15.4 88 16.4 84Z'],
    ['calves', 'M26.2 87.4C29 87.4 32 86 34 83.6C34.8 88.6 34.6 93.6 33.6 98H26.2Z'],
  ] },
  calvesBack: { box: '2 0 96 100', mid: 50, parts: [
    ['hamstrings', 'M17 2H28.6C28.4 6 28 9.6 27 13C23.6 12 20 12 16.6 13.6C16 9.6 16.2 5.6 17 2Z'],
    ['hamstrings', 'M31.4 2H43C43.8 5.6 44 9.6 43.4 13.6C40 12 36.4 12 33 13C32 9.6 31.6 6 31.4 2Z'],
    ['calves', 'M16.2 15.8C19.8 14 24.6 14 28.6 15.6V55C27 58 25.4 60 23.6 61C17.6 54 13.6 44 13.2 33C13 26.6 14 20.6 16.2 15.8Z'],
    ['calves', 'M31.4 15.6C35.4 14 40.2 14 43.8 15.8C46 20.6 47 26.6 46.8 33C46.4 46 42.4 57 36.4 64.6C34.4 63 32.6 60.6 31.4 57.6Z'],
    ['_achilles', 'M21.4 62C23.6 61 26 58.6 28.6 57.6H31.4C33 60.6 35.4 63.8 38.6 65.8C36.6 72 35 80 34.4 88H25.6C25 79 23.6 70 21.4 62Z'],
    ['_heel', 'M25.2 90H34.8C36.4 93 36.4 96 35 98.5H25C23.6 96 23.6 93 25.2 90Z'],
  ] },
};
const PANEL_OF: Record<Muscle, string> = {
  chest: 'torsoFront', shoulders: 'torsoFront', neck: 'torsoFront',
  lats: 'torsoBack', traps: 'torsoBack', middle_back: 'torsoBack', lower_back: 'torsoBack',
  biceps: 'arm', triceps: 'arm', forearms: 'arm',
  abdominals: 'abs', glutes: 'hipsBack',
  quadriceps: 'thighsFront', adductors: 'thighsFront', abductors: 'thighsFront',
  hamstrings: 'thighsBack', calves: 'calvesBack',
};

/** Whether these muscles have a figure. Cardio (by measure) and exercises with no muscle do not. */
export function hasMuscleFigure(muscles: readonly Muscle[] | undefined): muscles is readonly Muscle[] {
  return !!muscles?.length && muscles[0] in PANEL_OF;
}

/**
 * The figure's shapes, for use inside an `<svg>` (it is itself a nested `<svg>` when `x`, `y` and
 * `size` are given). The first muscle picks the panel; every listed muscle on that panel is lit.
 * `gap` is the colour between shapes: the surface the figure sits on.
 */
export function MuscleFigure({
  muscles,
  lit,
  dim,
  gap,
  x,
  y,
  size,
  className,
}: {
  muscles: readonly Muscle[];
  lit: string;
  dim: string;
  gap: string;
  x?: number;
  y?: number;
  size?: number;
  className?: string;
}) {
  const panel = PANELS[PANEL_OF[muscles[0]]];
  const width = Number(panel.box.split(' ')[2]);
  return (
    <svg
      viewBox={panel.box}
      x={x}
      y={y}
      width={size}
      height={size}
      className={className}
      stroke={gap}
      strokeWidth={width * 0.022}
      strokeLinejoin="round"
      aria-hidden
      data-muscle-figure={muscles[0]}
    >
      {panel.parts.map(([id, d], index) => {
        const fill = (muscles as readonly string[]).includes(id) ? lit : dim;
        return (
          <g key={index} fill={fill} data-lit={fill === lit || undefined}>
            <path d={d} />
            {panel.mid !== undefined && <path d={d} transform={`translate(${panel.mid * 2} 0) scale(-1 1)`} />}
          </g>
        );
      })}
    </svg>
  );
}

/** The plate inside a rank emblem is always dark, so the figure on it uses the dark-theme hues. */
const PLATE_HUES: Record<TrainingGroup, [number, number, number]> = {
  push: [251, 146, 60],
  pull: [96, 165, 250],
  legs: [52, 211, 153],
  core: [251, 191, 36],
  arms: [167, 139, 250],
  cardio: [244, 114, 182],
  other: [155, 163, 180],
};
export const RANK_PLATE = '#0e131d';
const PLATE_RGB = [14, 19, 29];

/** Lit and dim fills for a figure on the rank plate, in the muscles' group colour. */
export function plateColors(muscles: readonly Muscle[]): { lit: string; dim: string } {
  const hue = PLATE_HUES[exerciseGroup(muscles)];
  const dim = hue.map((value, k) => Math.round(value + (PLATE_RGB[k] - value) * 0.68));
  return { lit: `rgb(${hue.join(' ')})`, dim: `rgb(${dim.join(' ')})` };
}
