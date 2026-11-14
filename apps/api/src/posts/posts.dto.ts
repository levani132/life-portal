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
  IsOptional,
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
  FEED_METRIC_EVENTS,
  FEED_METRICS_RANGES,
  MAX_FOR_YOU_INTERESTS,
  MAX_POST_ITEMS,
  MAX_POST_MEDIA,
  MEAL_SLOTS,
  POST_KINDS,
  REPORT_REASONS,
  type Audience,
  type FeedMetricEvent,
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
/** `PUT /posts/for-you/preferences` (#10). Ids are checked against the catalogue in the service. */
export class FeedPreferencesDto {
  @IsArray()
  @ArrayMaxSize(MAX_FOR_YOU_INTERESTS)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  interests!: string[];
}
/** One For You measurement event (#11). The post is checked for eligibility in the service. */
class FeedMetricInputDto {
  @IsString() @MaxLength(24) postId!: string;
  @IsIn(FEED_METRIC_EVENTS) type!: FeedMetricEvent;
}
/** `POST /posts/for-you/metrics/events`: at most 50 events, the shared domain cap. */
export class FeedMetricsBatchDto {
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => FeedMetricInputDto)
  events!: FeedMetricInputDto[];
  @ValidateIf((_, v: unknown) => v !== undefined) @IsBoolean() visit?: boolean;
}
export class FeedMetricsOptOutDto {
  @IsBoolean() optedOut!: boolean;
}
export class FeedMetricsReportDto {
  @Type(() => Number) @IsIn(FEED_METRICS_RANGES) range = 7;
}
export class ForYouDto {
  @ValidateIf((_, v: unknown) => v !== undefined)
  @IsString()
  @MaxLength(256)
  cursor?: string;
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
  /** Spec 031: the id the device chose, so it can show and withdraw the comment before sync. */
  @IsOptional() @IsMongoId() id?: string;
}

