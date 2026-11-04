import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  MEDIA_KINDS,
  type MediaKind,
  type MediaUploadRequest,
} from '@life-portal/shared-types';

class PosterDto {
  @IsInt() @Min(1) @Max(50 * 1024 * 1024) bytes!: number;
}
/** Limits by kind are checked by `mediaLimitError`, shared with the browser. */
export class MediaUploadDto implements MediaUploadRequest {
  @IsIn(MEDIA_KINDS) kind!: MediaKind;
  @IsString() @MaxLength(64) contentType!: string;
  @IsInt() @Min(1) @Max(200 * 1024 * 1024) bytes!: number;
  @IsInt() @Min(1) @Max(8192) width!: number;
  @IsInt() @Min(1) @Max(8192) height!: number;
  @ValidateIf((_, v: unknown) => v !== undefined) @IsInt() @Min(1) durationMs?: number;
  @ValidateIf((_, v: unknown) => v !== undefined)
  @ValidateNested()
  @Type(() => PosterDto)
  poster?: PosterDto;
}
