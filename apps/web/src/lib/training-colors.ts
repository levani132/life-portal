'use client';

import {
  Activity,
  Dumbbell,
  Flame,
  Footprints,
  HeartPulse,
  Target,
  Waves,
  type LucideIcon,
} from 'lucide-react';
import type { Measure, Muscle, PlanList } from '@life-portal/shared-types';
import { useApi } from './hooks';
import { PLANS_KEY } from './training';

/**
 * Training's colour system (spec 024). Display only: a colour is derived from an exercise's
 * primary muscles or a plan's place in the list, never stored. Class strings are written out in
 * full because Tailwind only generates classes it can find as literals. The `train-*` colours are
 * CSS variables in `global.css`, themed so text stays readable in light and dark; `-solid` ones
 * carry white text in both themes.
 */

export type TrainingGroup = 'push' | 'pull' | 'legs' | 'core' | 'arms' | 'cardio' | 'other';

const MUSCLE_GROUPS: Record<Muscle, TrainingGroup> = {
  chest: 'push',
  shoulders: 'push',
  lats: 'pull',
  middle_back: 'pull',
  lower_back: 'pull',
  traps: 'pull',
  neck: 'pull',
  quadriceps: 'legs',
  hamstrings: 'legs',
  glutes: 'legs',
  calves: 'legs',
  abductors: 'legs',
  adductors: 'legs',
  abdominals: 'core',
  biceps: 'arms',
  triceps: 'arms',
  forearms: 'arms',
};

export function muscleGroup(muscle: Muscle): TrainingGroup {
  return MUSCLE_GROUPS[muscle] ?? 'other';
}

/** Cardio by measure; otherwise the first primary muscle's group; neutral when there is none. */
export function exerciseGroup(primaryMuscles: readonly Muscle[] | undefined, measure?: Measure): TrainingGroup {
  if (measure === 'distance_duration') return 'cardio';
  const first = primaryMuscles?.[0];
  return first ? muscleGroup(first) : 'other';
}

export interface GroupStyle {
  label: string;
  icon: LucideIcon;
  /** Coloured text, readable on the page surface. */
  text: string;
  /** A light tint behind coloured text or an icon. */
  tint: string;
  /** A soft coloured border. */
  border: string;
  /** A filled surface for white text. */
  solid: string;
  /** A gradient for headers and cards with white text (use with `bg-gradient-to-br`). */
  gradient: string;
  /** A small dot or bar. */
  dot: string;
  /** A coloured left edge on a card (use with `border-l-4`). */
  edge: string;
}

export const GROUP_STYLES: Record<TrainingGroup, GroupStyle> = {
  push: {
    label: 'Push',
    icon: Flame,
    text: 'text-train-push',
    tint: 'bg-train-push/10',
    border: 'border-train-push/40',
    solid: 'bg-train-push-solid text-white',
    gradient: 'from-train-push-solid to-train-cardio-solid',
    dot: 'bg-train-push-solid',
    edge: 'border-l-train-push-solid',
  },
  pull: {
    label: 'Pull',
    icon: Waves,
    text: 'text-train-pull',
    tint: 'bg-train-pull/10',
    border: 'border-train-pull/40',
    solid: 'bg-train-pull-solid text-white',
    gradient: 'from-train-pull-solid to-train-arms-solid',
    dot: 'bg-train-pull-solid',
    edge: 'border-l-train-pull-solid',
  },
  legs: {
    label: 'Legs',
    icon: Footprints,
    text: 'text-train-legs',
    tint: 'bg-train-legs/10',
    border: 'border-train-legs/40',
    solid: 'bg-train-legs-solid text-white',
    gradient: 'from-train-legs-solid to-train-pull-solid',
    dot: 'bg-train-legs-solid',
    edge: 'border-l-train-legs-solid',
  },
  core: {
    label: 'Core',
    icon: Target,
    text: 'text-train-core',
    tint: 'bg-train-core/10',
    border: 'border-train-core/40',
    solid: 'bg-train-core-solid text-white',
    gradient: 'from-train-core-solid to-train-push-solid',
    dot: 'bg-train-core-solid',
    edge: 'border-l-train-core-solid',
  },
  arms: {
    label: 'Arms',
    icon: Dumbbell,
    text: 'text-train-arms',
    tint: 'bg-train-arms/10',
    border: 'border-train-arms/40',
    solid: 'bg-train-arms-solid text-white',
    gradient: 'from-train-arms-solid to-train-cardio-solid',
    dot: 'bg-train-arms-solid',
    edge: 'border-l-train-arms-solid',
  },
  cardio: {
    label: 'Cardio',
    icon: HeartPulse,
    text: 'text-train-cardio',
    tint: 'bg-train-cardio/10',
    border: 'border-train-cardio/40',
    solid: 'bg-train-cardio-solid text-white',
    gradient: 'from-train-cardio-solid to-train-arms-solid',
    dot: 'bg-train-cardio-solid',
    edge: 'border-l-train-cardio-solid',
  },
  other: {
    label: 'Other',
    icon: Activity,
    text: 'text-ink-muted',
    tint: 'bg-ink-faint/10',
    border: 'border-border',
    solid: 'bg-slate-600 text-white',
    gradient: 'from-slate-600 to-slate-800',
    dot: 'bg-ink-faint',
    edge: 'border-l-border',
  },
};

/** Muscle groups in the order filters show them. */
export const GROUP_ORDER: readonly TrainingGroup[] = ['push', 'pull', 'legs', 'core', 'arms', 'cardio'];

// ------------------------------------------------------------------ plans

/** Ready-made plans take these in seed order, so the four are distinct on every device. */
const PLAN_HUES: readonly TrainingGroup[] = ['pull', 'push', 'arms', 'legs', 'cardio', 'core'];

function hash(text: string): number {
  let value = 0;
  for (let i = 0; i < text.length; i++) value = (value * 31 + text.charCodeAt(i)) >>> 0;
  return value;
}

/** A plan's colour: by its place among ready-made plans, else from its id. */
export function planGroup(id: string, sharedIndex?: number): TrainingGroup {
  if (sharedIndex !== undefined && sharedIndex >= 0) return PLAN_HUES[sharedIndex % PLAN_HUES.length];
  return PLAN_HUES[hash(id) % PLAN_HUES.length];
}

/** The plan's style wherever it shows, agreeing with its card (reads the cached plan list). */
export function usePlanStyle(id: string | undefined): GroupStyle {
  const { data } = useApi<PlanList>(id ? PLANS_KEY : null);
  if (!id) return { ...GROUP_STYLES.other, gradient: 'from-accent-solid to-train-arms-solid' };
  const index = data?.shared.findIndex((plan) => plan.id === id);
  return GROUP_STYLES[planGroup(id, index)];
}
