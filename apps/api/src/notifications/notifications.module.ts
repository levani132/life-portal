import {
  Body,
  CallHandler,
  Controller,
  Delete,
  ExecutionContext,
  Get,
  Global,
  HttpCode,
  Injectable,
  Module,
  NestInterceptor,
  Param,
  Post,
  Put,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import type { Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequireModule } from '../access/access.module';
import {
  NotificationDelivery,
  NotificationDeliverySchema,
  NotificationPreferencesRecord,
  NotificationPreferencesSchema,
  PushDevice,
  PushDeviceSchema,
} from './notifications.schemas';
import { NotificationsService } from './notifications.service';
import { PushSender } from './push-sender';
import {
  ActivityQueryDto,
  RegisterDeviceDto,
  UnregisterDeviceDto,
  UpdateNotificationPreferencesDto,
} from './notifications.dto';

@Injectable()
class NoStore implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    context
      .switchToHttp()
      .getResponse<Response>()
      .setHeader('Cache-Control', 'private, no-store');
    return next.handle();
  }
}

/**
 * `GET /config` deliberately has no feature requirement, so the web can learn whether to show
 * anything at all. Every other route needs `push`.
 */
@UseInterceptors(NoStore)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('config') config(@CurrentUser('userId') userId: string) {
    return this.notifications.config(userId);
  }

  @RequireModule('push')
  @Get('preferences')
  preferences(@CurrentUser('userId') userId: string) {
    return this.notifications.getPreferences(userId);
  }
  @RequireModule('push')
  @Put('preferences')
  updatePreferences(
    @CurrentUser('userId') userId: string,
    @Body() dto: UpdateNotificationPreferencesDto,
  ) {
    return this.notifications.updatePreferences(userId, dto);
  }
  @RequireModule('push')
  @Post('offer/dismiss')
  @HttpCode(200)
  dismissOffer(@CurrentUser('userId') userId: string) {
    return this.notifications.dismissOffer(userId);
  }

  @RequireModule('push')
  @Post('devices')
  registerDevice(
    @CurrentUser('userId') userId: string,
    @Body() dto: RegisterDeviceDto,
  ) {
    return this.notifications.registerDevice(
      userId,
      dto.subscription,
      dto.label.trim(),
      dto.enable === true,
    );
  }
  @RequireModule('push')
  @Get('devices')
  devices(@CurrentUser('userId') userId: string) {
    return this.notifications.listDevices(userId);
  }
  /** Sign-out: no feature check, so a device is always removable. */
  @Post('devices/unregister')
  @HttpCode(200)
  unregister(
    @CurrentUser('userId') userId: string,
    @Body() dto: UnregisterDeviceDto,
  ) {
    return this.notifications.unregister(userId, dto.endpoint);
  }
  @Delete('devices/:id') removeDevice(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
  ) {
    return this.notifications.removeDevice(userId, id);
  }

  @RequireModule('push')
  @Get('activity')
  activity(
    @CurrentUser('userId') userId: string,
    @Query() query: ActivityQueryDto,
  ) {
    return this.notifications.activity(
      userId,
      query.before ? new Date(query.before) : undefined,
    );
  }
  @RequireModule('push')
  @Get('activity/unseen')
  async unseen(@CurrentUser('userId') userId: string) {
    return { count: await this.notifications.badgeCount(userId) };
  }
  @RequireModule('push')
  @Post('activity/seen')
  @HttpCode(200)
  seen(@CurrentUser('userId') userId: string) {
    return this.notifications.markSeen(userId);
  }
}

/**
 * Global so any module can send through it. It depends only on other global services
 * (Access, SocialGraph, Config), so Social and Posts can use it without an import cycle.
 */
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PushDevice.name, schema: PushDeviceSchema },
      {
        name: NotificationPreferencesRecord.name,
        schema: NotificationPreferencesSchema,
      },
      { name: NotificationDelivery.name, schema: NotificationDeliverySchema },
    ]),
  ],
  providers: [NotificationsService, PushSender],
  exports: [NotificationsService],
  controllers: [NotificationsController],
})
export class NotificationsModule {}
