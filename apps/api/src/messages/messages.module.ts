import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Module,
  Param,
  Post,
  Put,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RequireModule } from '../access/access.module';
import { CurrentUser } from '../auth/current-user.decorator';
import { PostsModule } from '../posts/posts.module';
import { SocialModule, SocialNoStore } from '../social/social.module';
import {
  MuteDto,
  OpenConversationDto,
  PageQueryDto,
  SendMessageDto,
  SyncDto,
} from './messages.dto';
import {
  Conversation,
  ConversationSchema,
  Message,
  MessageSchema,
} from './messages.schemas';
import { MessagesService } from './messages.service';

/** Every route needs `messages`; every response is private and uncached (spec FR-025). */
@RequireModule('messages')
@UseInterceptors(SocialNoStore)
@Controller('messages')
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Get('conversations') inbox(@CurrentUser('userId') userId: string) {
    return this.messages.inbox(userId);
  }
  @Get('unread') async unread(@CurrentUser('userId') userId: string) {
    return { count: await this.messages.unreadCount(userId) };
  }
  @Post('conversations') open(
    @CurrentUser('userId') userId: string,
    @Body() dto: OpenConversationDto,
  ) {
    return this.messages.open(userId, dto.userId);
  }
  @Get('conversations/:id') view(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
  ) {
    return this.messages.view(userId, id);
  }
  @Get('conversations/:id/messages') page(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Query() query: PageQueryDto,
  ) {
    return this.messages.page(userId, id, query.before);
  }
  @Post('conversations/:id/sync')
  @HttpCode(200)
  sync(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: SyncDto,
  ) {
    return this.messages.sync(userId, id, dto.after, dto.since);
  }
  @Post('conversations/:id/messages') send(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.messages.send(userId, id, dto);
  }
  @Delete('conversations/:id/messages/:messageId') unsend(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Param('messageId') messageId: string,
  ) {
    return this.messages.unsend(userId, id, messageId);
  }
  @Put('conversations/:id/mute') mute(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: MuteDto,
  ) {
    return this.messages.mute(userId, id, dto.muted);
  }
}

@Module({
  imports: [
    SocialModule,
    PostsModule,
    MongooseModule.forFeature([
      { name: Conversation.name, schema: ConversationSchema },
      { name: Message.name, schema: MessageSchema },
    ]),
  ],
  controllers: [MessagesController],
  providers: [MessagesService],
})
export class MessagesModule {}
