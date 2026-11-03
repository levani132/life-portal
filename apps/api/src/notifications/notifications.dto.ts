import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDefined,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  Validate,
  ValidateNested,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { NOTIFICATION_TYPES } from '@life-portal/shared-types';
import { isPushServiceEndpoint } from '@life-portal/shared-domain';

@ValidatorConstraint({ name: 'pushServiceEndpoint' })
class PushServiceEndpoint implements ValidatorConstraintInterface {
  validate(value: unknown) {
    return typeof value === 'string' && isPushServiceEndpoint(value);
  }
  defaultMessage() {
    return 'endpoint must be an HTTPS URL of a known push service';
  }
}

@ValidatorConstraint({ name: 'notificationTypes' })
class NotificationTypeMap implements ValidatorConstraintInterface {
  validate(value: unknown) {
    return (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      Object.entries(value).every(
        ([key, flag]) =>
          (NOTIFICATION_TYPES as readonly string[]).includes(key) &&
          typeof flag === 'boolean',
      )
    );
  }
  defaultMessage() {
    return `types may only contain ${NOTIFICATION_TYPES.join(', ')} with true or false`;
  }
}

const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;

class SubscriptionKeysDto {
  @IsString() @Matches(BASE64URL) @MaxLength(200) p256dh!: string;
  @IsString() @Matches(BASE64URL) @MaxLength(100) auth!: string;
}

class SubscriptionDto {
  @IsString() @MaxLength(1024) @Validate(PushServiceEndpoint) endpoint!: string;
  @IsDefined()
  @ValidateNested()
  @Type(() => SubscriptionKeysDto)
  keys!: SubscriptionKeysDto;
}

export class RegisterDeviceDto {
  @IsDefined()
  @ValidateNested()
  @Type(() => SubscriptionDto)
  subscription!: SubscriptionDto;
  @IsString() @MinLength(1) @MaxLength(60) label!: string;
  /** true when the member just tapped "Turn on notifications"; false for a background re-sync. */
  @IsOptional() @IsBoolean() enable?: boolean;
}

export class UnregisterDeviceDto {
  @IsString() @MaxLength(1024) endpoint!: string;
}

export class UpdateNotificationPreferencesDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @Validate(NotificationTypeMap) types?: Record<string, boolean>;
  @IsOptional() @IsBoolean() showCommentPreviews?: boolean;
}

export class ActivityQueryDto {
  @IsOptional() @IsISO8601({ strict: true }) before?: string;
}
