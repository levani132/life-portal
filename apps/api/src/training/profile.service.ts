import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import type { RankStandards, TrainingProfile as TrainingProfileDto, WeightUnit } from '@life-portal/shared-types';
import { TrainingProfile } from './training.schemas';

const DEFAULTS: TrainingProfileDto = { weightUnit: 'kg', defaultRestSeconds: 90 };

/**
 * Training preferences, one row per user, created on first read.
 *
 * Upserts seed only the defaults the caller did not send: a field in both `$set` and
 * `$setOnInsert` makes Mongo reject the whole update (CLAUDE.md).
 */
@Injectable()
export class TrainingProfileService {
  constructor(
    @InjectModel(TrainingProfile.name) private readonly profiles: Model<TrainingProfile>,
  ) {}

  /** The profile without creating a row, for reads elsewhere (the Home card). */
  async read(userId: string): Promise<TrainingProfileDto> {
    return toDto(await this.profiles.findOne({ userId }).lean());
  }

  get(userId: string): Promise<TrainingProfileDto> {
    return this.upsert(userId, {});
  }

  update(userId: string, patch: Partial<TrainingProfileDto>): Promise<TrainingProfileDto> {
    return this.upsert(userId, patch);
  }

  private async upsert(
    userId: string,
    patch: Partial<TrainingProfileDto>,
  ): Promise<TrainingProfileDto> {
    const set: Partial<TrainingProfileDto> = {};
    if (patch.weightUnit !== undefined) set.weightUnit = patch.weightUnit;
    if (patch.defaultRestSeconds !== undefined) set.defaultRestSeconds = patch.defaultRestSeconds;
    if (patch.rankStandards !== undefined) set.rankStandards = patch.rankStandards;
    const onInsert: Record<string, unknown> = { userId };
    for (const [key, value] of Object.entries(DEFAULTS) as [string, unknown][]) {
      if (!(key in set)) onInsert[key] = value;
    }
    const row = await this.profiles
      .findOneAndUpdate(
        { userId },
        { ...(Object.keys(set).length ? { $set: set } : {}), $setOnInsert: onInsert },
        { upsert: true, new: true, runValidators: true },
      )
      .lean();
    return toDto(row);
  }
}

function toDto(row: { weightUnit?: string; defaultRestSeconds?: number; rankStandards?: string } | null): TrainingProfileDto {
  return {
    weightUnit: (row?.weightUnit ?? DEFAULTS.weightUnit) as WeightUnit,
    defaultRestSeconds: row?.defaultRestSeconds ?? DEFAULTS.defaultRestSeconds,
    ...(row?.rankStandards ? { rankStandards: row.rankStandards as RankStandards } : {}),
  };
}
