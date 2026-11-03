import {
  PostEngagementService,
  PostLikeRecord,
  PostLikeSchema,
  PostCommentRecord,
  PostCommentSchema,
} from './post-engagement.service';
import {
  Body,
  Controller,
  Delete,
  Get,
  Module,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RequireModule } from '../access/access.module';
import { CurrentUser } from '../auth/current-user.decorator';
import { NutritionModule } from '../nutrition/nutrition.module';
import { SocialModule, SocialNoStore } from '../social/social.module';
import {
  CreatePostDto,
  AddPostCommentDto,
  UpdatePostAudienceDto,
  ImportPostDto,
  PostListDto,
  PreviewPostDto,
  ReportPostDto,
  UpdatePostDto,
} from './posts.dto';
import {
  FoodPostRecord,
  FoodPostSchema,
  PostReportRecord,
  PostReportSchema,
} from './posts.schemas';
import { PostsService } from './posts.service';
@RequireModule('foodPosts')
@UseInterceptors(SocialNoStore)
@Controller('posts')
class PostsController {
  constructor(
    private readonly posts: PostsService,
    private readonly engagement: PostEngagementService,
  ) {}
  @Post('preview') preview(
    @CurrentUser('userId') userId: string,
    @Body() dto: PreviewPostDto,
  ) {
    return this.posts.preview(userId, dto);
  }
  @Post() create(
    @CurrentUser('userId') userId: string,
    @Body() dto: CreatePostDto,
  ) {
    return this.posts.create(userId, dto);
  }
  @Get() list(
    @CurrentUser('userId') userId: string,
    @Query() query: PostListDto,
  ) {
    return this.posts.list(userId, query);
  }
  @Get('reports') reports(@CurrentUser('userId') userId: string) {
    return this.posts.reportQueue(userId);
  }
  @Delete('reports/:id/post') moderate(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
  ) {
    return this.posts.moderate(userId, id);
  }
  @Get(':id/engagement') engagementStats(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
  ) {
    return this.engagement.stats(userId, id);
  }
  @Put(':id/like') like(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
  ) {
    return this.engagement.setLike(userId, id, true);
  }
  @Delete(':id/like') unlike(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
  ) {
    return this.engagement.setLike(userId, id, false);
  }
  @Get(':id/comments') comments(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Query('before') before?: string,
  ) {
    return this.engagement.list(userId, id, before);
  }
  @Post(':id/comments') addComment(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: AddPostCommentDto,
  ) {
    return this.engagement.add(userId, id, dto.text, dto.requestId);
  }
  @Delete(':id/comments/:commentId') removeComment(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Param('commentId') commentId: string,
  ) {
    return this.engagement.remove(userId, id, commentId);
  }
  @Patch(':id/audience') audience(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdatePostAudienceDto,
  ) {
    return this.posts.updateAudience(userId, id, dto.audience);
  }
  @Get(':id') detail(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
  ) {
    return this.posts.detail(userId, id);
  }
  @Patch(':id') update(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdatePostDto,
  ) {
    return this.posts.update(userId, id, dto);
  }
  @Delete(':id') remove(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
  ) {
    return this.posts.remove(userId, id);
  }
  @Get(':id/import') importPreview(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
  ) {
    return this.posts.importPreview(userId, id);
  }
  @Post(':id/import') import(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: ImportPostDto,
  ) {
    return this.posts.import(userId, id, dto);
  }
  @Post(':id/report') report(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: ReportPostDto,
  ) {
    return this.posts.report(userId, id, dto);
  }
}
@Module({
  imports: [
    NutritionModule,
    SocialModule,
    MongooseModule.forFeature([
      { name: FoodPostRecord.name, schema: FoodPostSchema },
      { name: PostLikeRecord.name, schema: PostLikeSchema },
      { name: PostCommentRecord.name, schema: PostCommentSchema },
      { name: PostReportRecord.name, schema: PostReportSchema },
    ]),
  ],
  controllers: [PostsController],
  providers: [PostsService, PostEngagementService],
  // Messages renders shared posts through the same read authorization as opening one.
  exports: [PostsService],
})
export class PostsModule {}
