import {
  Body,
  CallHandler,
  Controller,
  ExecutionContext,
  Get,
  Injectable,
  Module,
  NestInterceptor,
  Param,
  Post,
  Put,
  UseInterceptors,
} from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import type { Response } from 'express';
import { ArrayMaxSize, ArrayUnique, IsArray, IsIn } from 'class-validator';
import { BADGE_IDS, MAX_EQUIPPED_BADGES, type BadgeId } from '@life-portal/shared-types';
import { CurrentUser } from '../auth/current-user.decorator';
import { User, UserSchema } from '../auth/schemas/user.schema';
import { Today } from '../common/today';
import { NutritionModule } from '../nutrition/nutrition.module';
import { PortalModule } from '../portal/portal.module';
import { PostsModule } from '../posts/posts.module';
import { TrainingModule } from '../training/training.module';
import {
  BadgeAward,
  BadgeAwardSchema,
  BadgeSelection,
  BadgeSelectionSchema,
} from './badges.schemas';
import { BadgesService } from './badges.service';

class EquipBadgesDto {
  @IsArray()
  @ArrayMaxSize(MAX_EQUIPPED_BADGES)
  @ArrayUnique()
  @IsIn(BADGE_IDS, { each: true })
  badgeIds!: BadgeId[];
}

@Injectable()
class BadgesNoStore implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    context.switchToHttp().getResponse<Response>().setHeader('Cache-Control', 'private, no-store');
    return next.handle();
  }
}

/**
 * No `@RequireModule`: awarding keeps working while `social` is off, so nothing is lost when it
 * turns on. Each route applies its own gate (contracts/api.md).
 */
@UseInterceptors(BadgesNoStore)
@Controller('badges')
export class BadgesController {
  constructor(private readonly badges: BadgesService) {}

  @Get('me') mine(@CurrentUser('userId') userId: string, @Today() today: string) {
    return this.badges.mine(userId, today);
  }

  @Post('check') check(@CurrentUser('userId') userId: string, @Today() today: string) {
    return this.badges.check(userId, today);
  }

  @Put('me/equipped') equip(@CurrentUser('userId') userId: string, @Body() dto: EquipBadgesDto) {
    return this.badges.equip(userId, dto.badgeIds);
  }

  @Get('people/:id') person(@CurrentUser('userId') userId: string, @Param('id') id: string) {
    return this.badges.forPerson(userId, id);
  }
}

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: BadgeAward.name, schema: BadgeAwardSchema },
      { name: BadgeSelection.name, schema: BadgeSelectionSchema },
      { name: User.name, schema: UserSchema },
    ]),
    NutritionModule,
    PortalModule,
    PostsModule,
    TrainingModule,
  ],
  controllers: [BadgesController],
  providers: [BadgesService, BadgesNoStore],
  exports: [BadgesService],
})
export class BadgesModule {}
