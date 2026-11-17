import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type {
  Muscle,
  PublishedExercise,
  PublishedSet,
  SetType,
  TrainingAttachment,
  TrainingPostSelection,
  TrainingPublication,
} from '@life-portal/shared-types';
import { canonicalTrainingPublication, recapRecords, validTrainingSelection } from '@life-portal/shared-domain';
import { MediaService } from '../media/media.service';
import { CatalogueService, type ExerciseRow } from './catalogue.service';
import { PlansService, toTarget } from './plans.service';
import { SessionsService } from './sessions.service';

type StoredExercise = TrainingPublication['exercises'][number];

/**
 * Training sharing (spec 036): the only place a post's Training attachment is built from, and
 * copied back into, training data. Posts stores what this returns and never reads a training
 * collection itself, as with `NutritionPublicationService`.
 *
 * **The snapshot rule, again.** A publication is built here from the author's own rows at
 * publishing time. It is never accepted from a request and never refreshed: editing or deleting
 * the workout, plan or exercise afterwards changes no post.
 *
 * **What a snapshot may hold.** A workout holds exercise names, how many sets and of which type,
 * rest and duration. Weights and reps only with `includeSets`; records only with `showRecords`.
 * Never body weight (a bodyweight set's effective load, or a record that depends on a weigh-in),
 * rank, level or XP: nothing here reads them.
 */
@Injectable()
export class TrainingPublicationService {
  constructor(
    private readonly sessions: SessionsService,
    private readonly plans: PlansService,
    private readonly catalogue: CatalogueService,
    private readonly media: MediaService,
  ) {}

  hash(publication: TrainingPublication): string {
    return createHash('sha256').update(canonicalTrainingPublication(publication)).digest('hex');
  }

  /** The publication for a selection, from the caller's own data. Photos are still the caller's own files. */
  async snapshot(userId: string, selection: TrainingPostSelection): Promise<TrainingPublication> {
    if (!validTrainingSelection(selection)) throw new BadRequestException('Choose what to share.');
    switch (selection.kind) {
      case 'workout':
        return this.workout(userId, selection);
      case 'plan':
        return this.plan(userId, selection);
      case 'exercise':
        return this.exercise(userId, selection.exerciseId);
    }
  }

  /** As a viewer gets it: each photo a short-lived signed link, never its storage key. */
  async attachment(publication: TrainingPublication): Promise<TrainingAttachment> {
    const exercises = await Promise.all(
      publication.exercises.map(async ({ image, ...rest }) => {
        const url = image ? await this.media.signKey(image.key) : undefined;
        return { ...rest, ...(image && url ? { image: { url, width: image.width, height: image.height } } : {}) };
      }),
    );
    return { ...publication, exercises };
  }

  /**
   * The post's own copies of the photos, made when it is published: a later change to the
   * exercise's photo must not change the post. All or nothing: a photo that cannot be copied
   * fails the publish, and the copies already made are removed.
   */
  async withOwnPhotos(authorId: string, publication: TrainingPublication): Promise<TrainingPublication> {
    const made: string[] = [];
    try {
      const exercises: StoredExercise[] = [];
      for (const exercise of publication.exercises) {
        if (!exercise.image) {
          exercises.push(exercise);
          continue;
        }
        const key = await this.media.copyStored(exercise.image.key, `posts/${authorId}/training/`);
        made.push(key);
        exercises.push({ ...exercise, image: { ...exercise.image, key } });
      }
      return { ...publication, exercises };
    } catch (error) {
      await Promise.all(made.map((key) => this.media.deleteKey(key)));
      throw error;
    }
  }

  /** Removes a deleted post's own photo copies. Never throws. */
  async removePhotos(publication: TrainingPublication | undefined): Promise<void> {
    await Promise.all((publication?.exercises ?? []).map((exercise) => this.media.deleteKey(exercise.image?.key).catch(() => undefined)));
  }

  // ---------------------------------------------------------------- building

  /** The exercises a publication uses, keyed by ordinal, from the catalogue rows the caller can see. */
  private async dictionary(userId: string, ids: readonly string[], fallback: (id: string) => Partial<PublishedExercise> | undefined = () => undefined) {
    const rows = new Map((await this.catalogue.publishable(userId, ids)).map((row) => [String(row._id), row]));
    const exercises: StoredExercise[] = [];
    const keys = new Map<string, string>();
    for (const id of ids) {
      if (keys.has(id)) continue;
      const row = rows.get(id);
      const frozen = fallback(id);
      if (!row && !frozen) throw new BadRequestException('An exercise in it is no longer available.');
      const key = String(exercises.length);
      keys.set(id, key);
      exercises.push({ key, ...this.published(id, row, userId), ...frozen } as StoredExercise);
    }
    return { exercises, keyOf: (id: string) => keys.get(id) as string };
  }

  private published(id: string, row: ExerciseRow | undefined, userId: string): Partial<StoredExercise> {
    if (!row) return {};
    const base = {
      name: row.name,
      primaryMuscles: (row.primaryMuscles ?? []) as Muscle[],
      equipmentType: row.equipmentType as PublishedExercise['equipmentType'],
      measure: row.measure as PublishedExercise['measure'],
    };
    // A shared catalogue row: every member has it, so it is referenced.
    if (!row.userId) return { ...base, exerciseId: id };
    if (row.userId !== userId) return base;
    return {
      ...base,
      own: true,
      sourceId: id,
      ...(row.secondaryMuscles?.length ? { secondaryMuscles: row.secondaryMuscles as Muscle[] } : {}),
      ...(row.instructions?.length ? { instructions: row.instructions } : {}),
      ...(row.image ? { image: { key: row.image.key, width: row.image.width, height: row.image.height } } : {}),
    };
  }

  private async workout(userId: string, selection: Extract<TrainingPostSelection, { kind: 'workout' }>): Promise<TrainingPublication> {
    const session = await this.sessions.detail(userId, selection.sessionId);
    if (session.status !== 'finished') throw new BadRequestException('Finish the workout before sharing it.');
    const done = session.exercises.filter((exercise) => exercise.sets.length);
    if (!done.length) throw new BadRequestException('This workout has no sets to share.');
    // Names and muscles as they were in the workout (its own snapshot), not as the catalogue says now.
    const frozen = new Map(done.map((exercise) => [exercise.exerciseId, exercise.snapshot]));
    const { exercises, keyOf } = await this.dictionary(
      userId,
      done.map((exercise) => exercise.exerciseId),
      (id) => {
        const snapshot = frozen.get(id);
        return snapshot && { name: snapshot.name, primaryMuscles: snapshot.primaryMuscles, equipmentType: snapshot.equipmentType, measure: snapshot.measure };
      },
    );
    const name = session.plan?.workoutName ?? 'Workout';
    const records = selection.showRecords
      ? recapRecords(session).flatMap((record) =>
          // A record that depends on a weigh-in would give the body weight away: never shared.
          record.entry && !record.entry.bodyWeightDay
            ? [{ key: keyOf(record.exerciseId), kind: record.kind, value: record.entry.value, ...(record.entry.loadGrams != null ? { loadGrams: record.entry.loadGrams } : {}) }]
            : [],
        )
      : undefined;
    return {
      kind: 'workout',
      label: name,
      exercises,
      workout: {
        name,
        day: session.day,
        durationSeconds: session.durationSeconds,
        exercises: done.map((exercise) => ({
          key: keyOf(exercise.exerciseId),
          setTypes: exercise.sets.map((set) => set.type as SetType),
          ...(exercise.restSeconds != null ? { restSeconds: exercise.restSeconds } : {}),
          ...(exercise.superset ? { superset: exercise.superset } : {}),
          ...(selection.includeSets ? { logged: exercise.sets.map(loggedSet) } : {}),
        })),
        ...(records?.length ? { records } : {}),
      },
    };
  }

  private async plan(userId: string, selection: Extract<TrainingPostSelection, { kind: 'plan' }>): Promise<TrainingPublication> {
    const row = await this.plans.readable(userId, selection.planId);
    // Only the caller's own plan: a ready-made one is everyone's already, and nobody else's is readable.
    if (row.userId !== userId || row.archived) throw new NotFoundException(`Plan ${selection.planId} not found`);
    const wanted = selection.workoutIds ? new Set(selection.workoutIds) : undefined;
    const workouts = row.workouts.filter((workout) => !wanted || wanted.has(workout.id));
    if (wanted && workouts.length !== wanted.size) throw new BadRequestException('A chosen workout is no longer in the plan.');
    if (!workouts.length) throw new BadRequestException('Choose at least one workout to share.');
    const { exercises, keyOf } = await this.dictionary(userId, workouts.flatMap((workout) => workout.exercises.map((exercise) => exercise.exerciseId)));
    return {
      kind: 'plan',
      label: row.name,
      exercises,
      plan: {
        name: row.name,
        ...(row.description ? { description: row.description } : {}),
        includedWorkouts: workouts.length,
        totalWorkouts: row.workouts.length,
        workouts: workouts.map((workout) => ({
          name: workout.name,
          exercises: workout.exercises.map((exercise) => ({
            key: keyOf(exercise.exerciseId),
            ...(exercise.restSeconds != null ? { restSeconds: exercise.restSeconds } : {}),
            ...(exercise.note ? { note: exercise.note } : {}),
            ...(exercise.superset ? { superset: exercise.superset } : {}),
            targets: exercise.targets.map(toTarget),
          })),
        })),
      },
    };
  }

  private async exercise(userId: string, exerciseId: string): Promise<TrainingPublication> {
    const [row] = await this.catalogue.publishable(userId, [exerciseId]);
    // Only an own exercise: a catalogue one is everyone's already.
    if (!row || row.userId !== userId || row.archived) throw new NotFoundException(`Exercise ${exerciseId} not found`);
    const { exercises, keyOf } = await this.dictionary(userId, [exerciseId]);
    return { kind: 'exercise', label: row.name, exercises, exercise: { key: keyOf(exerciseId) } };
  }
}

/** A logged set as shared: its own numbers. Never the effective load, which holds the body weight. */
function loggedSet(set: { type: string; reps?: number; weightGrams?: number; assistGrams?: number; durationSeconds?: number; distanceMeters?: number }): PublishedSet {
  const out: PublishedSet = { type: set.type as SetType };
  for (const field of ['reps', 'weightGrams', 'assistGrams', 'durationSeconds', 'distanceMeters'] as const) {
    if (set[field] != null) out[field] = set[field];
  }
  return out;
}
