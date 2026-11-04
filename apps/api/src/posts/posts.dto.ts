import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsMongoId,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  AUDIENCES,
  MAX_POST_ITEMS,
  MAX_POST_MEDIA,
  MEAL_SLOTS,
  POST_KINDS,
  REPORT_REASONS,
  type Audience,
  type FoodPostKind,
  type MealSlot,
  type PostSelection,
  type ReportReason,
} from '@life-portal/shared-types';
class ComponentDto {
  @IsMongoId() foodId!: string;
  @IsInt() @Min(1) @Max(20000) amount!: number;
}
export class PostSelectionDto implements PostSelection {
  @IsIn(POST_KINDS) kind!: FoodPostKind;
  @ValidateIf((_, v: unknown) => v !== undefined) @IsMongoId() entryId?: string;
  @ValidateIf((_, v: unknown) => v !== undefined)
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  day?: string;
  @ValidateIf((_, v: unknown) => v !== undefined)
  @IsIn(MEAL_SLOTS)
  slot?: MealSlot;
  @ValidateIf((_, v: unknown) => v !== undefined) @IsMongoId() foodId?: string;
  @ValidateIf((_, v: unknown) => v !== undefined)
  @IsMongoId()
  savedMealId?: string;
  @ValidateIf((_, v: unknown) => v !== undefined)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_POST_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => ComponentDto)
  components?: ComponentDto[];
}
export class PreviewPostDto {
  @ValidateNested() @Type(() => PostSelectionDto) source!: PostSelectionDto;
}
export class CreatePostDto {
  /** Absent for a post without food. */
  @ValidateIf((_, v: unknown) => v !== undefined)
  @ValidateNested()
  @Type(() => PostSelectionDto)
  source?: PostSelectionDto;
  @ValidateIf((o: CreatePostDto) => o.source !== undefined)
  @Matches(/^[a-f0-9]{64}$/)
  previewHash?: string;
  @ValidateIf((_, v: unknown) => v !== undefined)
  @IsArray()
  @ArrayMaxSize(MAX_POST_MEDIA)
  @ArrayUnique()
  @IsMongoId({ each: true })
  mediaIds?: string[];
  @IsUUID() requestId!: string;
  @IsString() @MaxLength(120) title!: string;
  @IsString() @MaxLength(1000) caption!: string;
  @IsIn(AUDIENCES) audience!: Audience;
}
export class UpdatePostDto {
  @IsString() @MaxLength(120) title!: string;
  @IsString() @MaxLength(1000) caption!: string;
  @IsIn(AUDIENCES) audience!: Audience;
}
export class PostListDto {
  @ValidateIf((_, v: unknown) => v !== undefined)
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  today?: string;
  @ValidateIf((_, v: unknown) => v !== undefined)
  @IsMongoId()
  authorId?: string;
  @ValidateIf((_, v: unknown) => v !== undefined)
  @IsString()
  @MaxLength(256)
  cursor?: string;
  @IsIn(['normal', 'friend', 'stranger']) preview:
    | 'normal'
    | 'friend'
    | 'stranger' = 'normal';
}
export class ImportPostDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_POST_ITEMS)
  @ArrayUnique()
  @Matches(/^\d{1,4}$/, { each: true })
  itemKeys!: string[];
  @IsIn(['skip', 'copy']) duplicatePolicy: 'skip' | 'copy' = 'skip';
  @IsBoolean() saveAsMeal = false;
  @ValidateIf((_, v: unknown) => v !== undefined)
  @IsString()
  @MaxLength(120)
  mealName?: string;
}
export class ReportPostDto {
  @IsIn(REPORT_REASONS) reason!: ReportReason;
}

export class UpdatePostAudienceDto {
  @IsIn(AUDIENCES) audience!: Audience;
}
export class AddPostCommentDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Matches(/\S/)
  @MaxLength(1000)
  text!: string;
  @IsUUID() requestId!: string;
}

