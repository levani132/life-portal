'use client';

import { useState } from 'react';
import { ExerciseDetail } from './exercise-detail';
import { ExerciseSearch } from './exercise-picker';

/**
 * The Exercises tab: browse the catalogue and your own exercises. There is no machine list any
 * more (#14): an exercise names its equipment, and equipment is a filter.
 */
export function ExerciseLibrary() {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      {/* Tighter than a Panel on a phone, so the rows get the width. */}
      <section className="card p-3 sm:p-5">
        <header className="mb-3">
          <h2 className="text-sm font-semibold text-ink">Exercises</h2>
          <p className="mt-0.5 text-xs text-ink-faint">Search the catalogue, or create your own.</p>
        </header>
        <ExerciseSearch onPick={(exercise) => setOpenId(exercise.id)} />
      </section>
      {openId && <ExerciseDetail id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}
