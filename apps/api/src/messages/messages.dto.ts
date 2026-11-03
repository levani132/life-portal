import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsISO8601,
  IsMongoId,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { MAX_MESSAGE_LENGTH } from '@life-portal/shared-types';

export class OpenConversationDto {
  @IsMongoId() userId!: string;
}

/** Exactly one of `text` or `postId`. */
export class SendMessageDto {
  @IsUUID() requestId!: string;
  @ValidateIf((dto: SendMessageDto) => dto.postId === undefined)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Matches(/\S/, { message: 'Write a message.' })
  @MaxLength(MAX_MESSAGE_LENGTH)
  text?: string;
  @ValidateIf((dto: SendMessageDto) => dto.text === undefined)
  @IsMongoId()
  postId?: string;
}

export class SyncDto {
  @IsOptional() @IsMongoId() after?: string;
  @IsOptional() @IsISO8601({ strict: true }) since?: string;
}

export class PageQueryDto {
  @IsOptional() @IsMongoId() before?: string;
}

export class MuteDto {
  @IsBoolean() muted!: boolean;
}
