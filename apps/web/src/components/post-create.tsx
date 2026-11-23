'use client';

import { BookOpen, ClipboardList, CookingPot, Dumbbell, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { FoodWithUsage, PlanList, TrainingPostSelection } from '@life-portal/shared-types';
import { useApi } from '../lib/hooks';
import { FoodForm } from './food-form';
import { RecipeEditor } from './page-library';
import type { PickedFood } from './post-food-picker';
import { ExerciseForm } from './training/exercise-form';
import { PlanEditor } from './training/plan-editor';
import { Modal } from './ui';

export type CreateKind = 'food' | 'recipe' | 'exercise' | 'plan' | 'existing-plan';

const KINDS: { id: CreateKind; label: string; detail: string; icon: typeof CookingPot }[] = [
  { id: 'food', label: 'Food', detail: 'A food with its numbers, for people to save', icon: CookingPot },
  { id: 'recipe', label: 'Recipe', detail: 'Several of your foods with amounts', icon: BookOpen },
  { id: 'existing-plan', label: 'One of my training plans', detail: 'Attach a plan you already have', icon: ClipboardList },
  { id: 'plan', label: 'New training plan', detail: 'Workouts with exercises and planned sets', icon: ClipboardList },
  { id: 'exercise', label: 'Exercise', detail: 'One exercise of your own', icon: Dumbbell },
];

/**
 * "Create" in the composer (spec 041): make a food, a recipe, a training plan or an exercise
 * without leaving the post. What is made is saved to the library as it would be anywhere else,
 * and comes back attached to the post.
 */
export function PostCreate({
  open,
  kinds,
  onClose,
  onFood,
  onTraining,
}: {
  open: boolean;
  /** Which kinds this person or page may create here. */
  kinds: CreateKind[];
  onClose: () => void;
  onFood: (picked: PickedFood) => void;
  onTraining: (selection: TrainingPostSelection) => void;
}) {
  const [creating, setCreating] = useState<CreateKind | null>(null);
  const needsFoods = creating === 'recipe';
  const foods = useApi<FoodWithUsage[]>(needsFoods ? '/nutrition/foods' : null);
  const plans = useApi<PlanList>(creating === 'existing-plan' ? '/training/plans' : null);
  const live = useMemo(() => (foods.data ?? []).filter((food) => !food.archived), [foods.data]);
  const done = () => {
    setCreating(null);
    onClose();
  };

  return (
    <>
      <Modal open={open && creating === null} onClose={onClose} title="Create and attach">
        <ul className="space-y-2">
          {KINDS.filter((kind) => kinds.includes(kind.id)).map((kind) => (
            <li key={kind.id}>
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-xl border border-border px-4 py-3 text-left hover:bg-surface-raised"
                onClick={() => setCreating(kind.id)}
              >
                <kind.icon size={20} className="shrink-0 text-accent" aria-hidden="true" />
                <span>
                  <span className="block font-medium">{kind.label}</span>
                  <span className="block text-xs text-ink-muted">{kind.detail}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-ink-faint">
          What you make is saved to your library and attached. A post can carry food and training together: add one, then the other.
        </p>
      </Modal>

      <FoodForm
        open={creating === 'food'}
        onClose={() => setCreating(null)}
        lookupAvailable
        onSaved={(food) => {
          if (food) onFood({ source: { kind: 'food', foodId: food.id }, label: food.name });
          done();
        }}
      />

      {creating === 'recipe' &&
        (foods.data && live.length === 0 ? (
          <Modal open onClose={() => setCreating(null)} title="New recipe">
            <p className="text-sm text-ink-muted">A recipe is built from your foods, and you have none yet. Create a food first.</p>
          </Modal>
        ) : foods.data ? (
          <RecipeEditor
            foods={live}
            onClose={() => setCreating(null)}
            onSaved={(meal) => {
              onFood({ source: { kind: 'combination', savedMealId: meal.id }, label: meal.name });
              done();
            }}
          />
        ) : null)}

      {creating === 'existing-plan' && (
        <Modal open onClose={() => setCreating(null)} title="Attach a training plan">
          {!plans.data ? (
            <p className="text-sm text-ink-muted">{plans.error ? (plans.error as Error).message : 'Loading…'}</p>
          ) : plans.data.own.length === 0 ? (
            <p className="text-sm text-ink-muted">You have no training plans yet. Create one instead.</p>
          ) : (
            <ul className="space-y-2">
              {plans.data.own.map((plan) => (
                <li key={plan.id}>
                  <button
                    type="button"
                    className="flex w-full flex-col rounded-xl border border-border px-4 py-3 text-left hover:bg-surface-raised"
                    onClick={() => {
                      onTraining({ kind: 'plan', planId: plan.id });
                      done();
                    }}
                  >
                    <span className="font-medium">{plan.name}</span>
                    <span className="text-xs text-ink-muted">
                      {plan.workoutCount} {plan.workoutCount === 1 ? 'workout' : 'workouts'} · {plan.exerciseCount} exercises
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}

      <ExerciseForm
        open={creating === 'exercise'}
        onClose={() => setCreating(null)}
        onSaved={(exercise) => {
          onTraining({ kind: 'exercise', exerciseId: exercise.id });
          done();
        }}
      />

      {creating === 'plan' && (
        <div
          className="fixed inset-0 z-[60] flex flex-col bg-surface"
          role="dialog"
          aria-modal="true"
          aria-label="New training plan"
          data-no-tab-swipe
        >
          <header className="flex items-center gap-2 border-b border-border px-2 pb-2 pt-[calc(env(safe-area-inset-top)+0.5rem)]">
            <button
              type="button"
              aria-label="Back to post"
              className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-ink/5"
              onClick={() => setCreating(null)}
            >
              <X size={22} />
            </button>
            <h2 className="flex-1 text-center text-base font-semibold">New training plan</h2>
            <span className="h-10 w-10" />
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3">
            <PlanEditor
              onDone={(id) => {
                if (id) {
                  onTraining({ kind: 'plan', planId: id });
                  done();
                } else setCreating(null);
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}
