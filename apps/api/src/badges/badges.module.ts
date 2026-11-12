import {
  CallHandler,
  Controller,
  ExecutionContext,
  Get,
  Injectable,
  Module,
  NestInterceptor,
  Post,
  UseInterceptors,
} from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import type { Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import { User, UserSchema } from '../auth/schemas/user.schema';
import { Today } from '../common/today';
import { NutritionModule } from '../nutrition/nutrition.module';
import { PortalModule } from '../portal/portal.module';
import { PostsModule } from '../posts/posts.module';
import {
  BadgeAward,
  BadgeAwardSchema,
  BadgeSelection,
  BadgeSelectionSchema,
} from './badges.schemas';
import { BadgesService } from './badges.service';

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
  ],
  controllers: [BadgesController],
  providers: [BadgesService, BadgesNoStore],
  exports: [BadgesService],
})
export class BadgesModule {}
