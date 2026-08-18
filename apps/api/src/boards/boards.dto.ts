import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  ATTENTION_STATES,
  BOARD_FEATURES,
  BOARD_KINDS,
  CONTRIBUTION_TYPES,
  TASK_STATUSES,
} from '@life-portal/shared-types';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const IMPACTS = ['promotion', 'performance_review', 'revenue', 'maintenance', 'learning'] as const;

export class CreateBoardDto {
  @Matches(/^[a-z0-9-]{2,40}$/, { message: 'Key must be a lowercase slug, e.g. client-project' })
  key!: string;
  @IsString() @MaxLength(80) name!: string;
  @IsIn(BOARD_KINDS) kind!: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsString() @MaxLength(24) accent?: string;
  @IsOptional() @IsArray() @IsIn(BOARD_FEATURES, { each: true }) features?: string[];
  @IsOptional() @IsInt() order?: number;
  @IsOptional() @IsBoolean() archived?: boolean;
}

export class UpdateBoardDto extends CreateBoardDto {
  @IsOptional() @Matches(/^[a-z0-9-]{2,40}$/) override key!: string;
  @IsOptional() @IsString() @MaxLength(80) override name!: string;
  @IsOptional() @IsIn(BOARD_KINDS) override kind!: string;
}

export class CreateTaskDto {
  @IsString() @MaxLength(300) title!: string;
  @IsOptional() @IsString() @MaxLength(8000) notes?: string;
  @IsOptional() @IsIn(TASK_STATUSES) status?: string;
  @IsOptional() @IsInt() @Min(1) @Max(4) priority?: number;
  @IsOptional() @Matches(DAY) dueDate?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) tags?: string[];
  @IsOptional() @IsIn(IMPACTS) impact?: string;
  @IsOptional() @IsInt() @Min(0) estimateHours?: number;
  @IsOptional() @IsInt() order?: number;
  @IsOptional() @IsString() @MaxLength(500) blockedReason?: string;
}

export class UpdateTaskDto extends CreateTaskDto {
  @IsOptional() @IsString() @MaxLength(300) override title!: string;
}

export class CreateNoteDto {
  @IsString() @MaxLength(300) title!: string;
  @IsOptional() @IsString() @MaxLength(20000) body?: string;
  @IsOptional() @IsBoolean() pinned?: boolean;
  @IsOptional() @IsArray() @IsString({ each: true }) tags?: string[];
}

export class UpdateNoteDto extends CreateNoteDto {
  @IsOptional() @IsString() @MaxLength(300) override title!: string;
}

export class CreatePersonDto {
  @IsString() @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(80) role?: string;
  @IsOptional() @IsString() @MaxLength(20) level?: string;
  @IsOptional() @IsString() @MaxLength(120) project?: string;
  @IsOptional() @IsString() @MaxLength(200) email?: string;
  @IsOptional() @IsIn(ATTENTION_STATES) attentionState?: string;
  @IsOptional() @IsString() @MaxLength(1000) attentionReason?: string;
  @IsOptional() @Matches(DAY) nextCheckIn?: string;
  @IsOptional() @Matches(DAY) lastOneOnOne?: string;
  @IsOptional() @IsInt() @Min(1) oneOnOneCadenceDays?: number;
  @IsOptional() @Matches(DAY) nextReviewDate?: string;
  @IsOptional() @IsString() @MaxLength(8000) notes?: string;
  @IsOptional() @IsBoolean() archived?: boolean;
}

export class UpdatePersonDto extends CreatePersonDto {
  @IsOptional() @IsString() @MaxLength(120) override name!: string;
}

export class CreateContributionDto {
  @IsIn(CONTRIBUTION_TYPES) type!: string;
  @IsString() @MaxLength(300) title!: string;
  @IsOptional() @Matches(DAY) date?: string;
  /** Omit to use the default weight for the type. */
  @IsOptional() @IsInt() @Min(0) points?: number;
  @IsOptional() @IsString() @MaxLength(1000) outcome?: string;
  @IsOptional() @IsMongoId() personId?: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class UpdateContributionDto extends CreateContributionDto {
  @IsOptional() @IsIn(CONTRIBUTION_TYPES) override type!: string;
  @IsOptional() @IsString() @MaxLength(300) override title!: string;
}

export class CreateWinDto {
  @IsString() @MaxLength(300) title!: string;
  @IsOptional() @Matches(DAY) date?: string;
  @IsOptional() @IsString() @MaxLength(1000) impact?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) witnesses?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) tags?: string[];
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
}

export class UpdateWinDto extends CreateWinDto {
  @IsOptional() @IsString() @MaxLength(300) override title!: string;
}

export class ReorderDto {
  @IsArray()
  @IsMongoId({ each: true })
  order!: string[];
}
