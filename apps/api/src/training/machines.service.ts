import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, type Model } from 'mongoose';
import type {
  EquipmentType,
  Machine,
  MachineInput,
  MachinePatch,
  TrainingDeleteResult,
} from '@life-portal/shared-types';
import { MediaService } from '../media/media.service';
import { CatalogueService, signImage } from './catalogue.service';
import { TrainingMachine, WorkoutExercise } from './training.schemas';

type MachineRow = TrainingMachine & { _id: unknown };

/**
 * Specific machines ("Hammer Strength Iso-Lateral Row"). Private to their creator in this phase
 * (research R10), so every query carries `userId`. A machine is deleted when no workout names it
 * and archived when one does, exactly like a private exercise.
 */
@Injectable()
export class MachinesService {
  constructor(
    @InjectModel(TrainingMachine.name) private readonly machines: Model<TrainingMachine>,
    @InjectModel(WorkoutExercise.name) private readonly workoutExercises: Model<WorkoutExercise>,
    private readonly catalogue: CatalogueService,
    private readonly media: MediaService,
  ) {}

  async list(userId: string, exerciseId?: string): Promise<Machine[]> {
    const rows = await this.machines
      .find({ userId, archived: false, ...(exerciseId ? { exerciseIds: exerciseId } : {}) })
      .sort({ name: 1, _id: 1 })
      .limit(200)
      .lean<MachineRow[]>();
    return Promise.all(rows.map((row) => this.toMachine(row)));
  }

  async get(userId: string, id: string): Promise<Machine> {
    return this.toMachine(await this.owned(userId, id, { includeArchived: true }));
  }

  /** The caller's machine, or 404. Used by sessions to name the machine in a snapshot. */
  async owned(userId: string, id: string, options: { includeArchived?: boolean } = {}): Promise<MachineRow> {
    if (!isValidObjectId(id)) throw new NotFoundException(`Machine ${id} not found`);
    const row = await this.machines
      .findOne({ _id: id, userId, ...(options.includeArchived ? {} : { archived: false }) })
      .lean<MachineRow>();
    if (!row) throw new NotFoundException(`Machine ${id} not found`);
    return row;
  }

  async create(userId: string, input: MachineInput): Promise<Machine> {
    const exerciseIds = await this.readableExercises(userId, input.exerciseIds ?? []);
    const brand = input.brand?.trim();
    const created = await this.machines.create({
      userId,
      name: input.name.trim(),
      ...(brand ? { brand } : {}),
      equipmentType: input.equipmentType,
      exerciseIds,
      archived: false,
    });
    const row = created.toObject() as MachineRow;
    if (!input.imageMediaId) return this.toMachine(row);
    try {
      const image = await this.media.copyForTraining(userId, input.imageMediaId, 'machines', String(row._id));
      await this.machines.updateOne({ _id: row._id, userId }, { $set: { image } });
      return this.toMachine({ ...row, image });
    } catch (error) {
      await this.machines.deleteOne({ _id: row._id, userId });
      throw error;
    }
  }

  async update(userId: string, id: string, patch: MachinePatch): Promise<Machine> {
    const row = await this.owned(userId, id);
    const set: Record<string, unknown> = {};
    const unset: Record<string, 1> = {};
    if (patch.name !== undefined) set['name'] = patch.name.trim();
    if (patch.brand !== undefined) {
      if (patch.brand.trim()) set['brand'] = patch.brand.trim();
      else unset['brand'] = 1;
    }
    if (patch.equipmentType !== undefined) set['equipmentType'] = patch.equipmentType;
    if (patch.exerciseIds !== undefined) set['exerciseIds'] = await this.readableExercises(userId, patch.exerciseIds);
    if (patch.imageMediaId) set['image'] = await this.media.copyForTraining(userId, patch.imageMediaId, 'machines', id);
    else if (patch.removeImage) unset['image'] = 1;
    if (Object.keys(set).length || Object.keys(unset).length) {
      await this.machines.updateOne(
        { _id: row._id, userId },
        { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) },
      );
    }
    if (row.image && (patch.imageMediaId || patch.removeImage)) void this.media.deleteKey(row.image.key);
    return this.get(userId, id);
  }

  async remove(userId: string, id: string): Promise<TrainingDeleteResult> {
    const row = await this.owned(userId, id, { includeArchived: true });
    if (await this.workoutExercises.exists({ userId, machineId: id })) {
      await this.machines.updateOne({ _id: row._id, userId }, { $set: { archived: true } });
      return { id, archived: true };
    }
    await this.machines.deleteOne({ _id: row._id, userId });
    void this.media.deleteKey(row.image?.key);
    return { id, deleted: true };
  }

  /** Every id must be an exercise the caller can read (shared or own, not archived). */
  private async readableExercises(userId: string, ids: string[]): Promise<string[]> {
    const uniqueIds = [...new Set(ids)];
    const rows = await Promise.all(uniqueIds.map((id) => this.catalogue.readable(userId, id)));
    return rows.map((row) => String(row._id));
  }

  private async toMachine(row: MachineRow): Promise<Machine> {
    return {
      id: String(row._id),
      name: row.name,
      brand: row.brand,
      equipmentType: row.equipmentType as EquipmentType,
      exerciseIds: row.exerciseIds ?? [],
      archived: row.archived,
      image: await signImage(this.media, row.image),
    };
  }
}
