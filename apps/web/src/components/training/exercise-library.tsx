'use client';

import { useState } from 'react';
import { Panel } from '../ui';
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
      <Panel title="Exercises" description="Search the catalogue, or create your own.">
        <ExerciseSearch onPick={(exercise) => setOpenId(exercise.id)} />
      </Panel>
      {openId && <ExerciseDetail id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}
