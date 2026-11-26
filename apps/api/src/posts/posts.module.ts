import type { PublicPortal, TrainingPostSelection } from '@life-portal/shared-types';
import { TrainingModule } from '../training/training.module';
import {
  PostEngagementService,
  PostLikeRecord,
  PostLikeSchema,
  PostCommentLikeRecord,
  PostCommentLikeSchema,
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
  HttpCode,
} from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RequireModule } from '../access/access.module';
import { CurrentUser, Public } from '../auth/current-user.decorator';
import { NutritionModule } from '../nutrition/nutrition.module';
import { SocialModule, SocialNoStore, SocialService } from '../social/social.module';
import {
  CreatePostDto,
  AddPostCommentDto,
  UpdatePostAudienceDto,
  FeedMetricsBatchDto,
  FeedMetricsOptOutDto,
  FeedMetricsReportDto,
  FeedPreferencesDto,
  ForYouDto,
  ImportPostDto,
  TrainingCopyDto,
  PostListDto,
  PreviewPostDto,
  ReportPostDto,
  UpdatePostDto,
  PostViewsDto,
} from './posts.dto';
import {
  FeedFeedbackRecord,
  FeedFeedbackSchema,
  FeedPreferencesRecord,
  FeedPreferencesSchema,
  FoodPostRecord,
  FoodPostSchema,
  ForYouSessionRecord,
  ForYouSessionSchema,
  PostReportRecord,
  PostReportSchema,
} from './posts.schemas';
import { PostsService } from './posts.service';
import { PostModerationService } from './post-moderation.service';
import { MailModule } from '../mail/mail.module';
import { ForYouService } from './for-you.service';
import {
  FeedMetricKeyRecord,
  FeedMetricKeySchema,
  FeedMetricsDailyRecord,
  FeedMetricsDailySchema,
  FeedMetricsService,
} from './feed-metrics.service';
import { ForPages } from '../auth/acting';
import { User, UserSchema } from '../auth/schemas/user.schema';
import { PageInsightsService, PostViewKeyRecord, PostViewKeySchema, PostViewsDailyRecord, PostViewsDailySchema } from './page-insights.service';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
@RequireModule('foodPosts')
@UseInterceptors(SocialNoStore)
@ForPages()
@Controller('posts')
class PostsController {
  constructor(
    private readonly posts: PostsService,
    private readonly engagement: PostEngagementService,
    private readonly forYouFeed: ForYouService,
    private readonly metrics: FeedMetricsService,
    private readonly insights: PageInsightsService,
    private readonly moderation: PostModerationService,
  ) {}
  @Post('preview') preview(
    @CurrentUser('userId') userId: string,
    @Body() dto: PreviewPostDto,
  ) {
    // Spec 036: a Training attachment has its own preview and its own hash.
    if (dto.training) return this.posts.previewTraining(userId, dto.training as TrainingPostSelection);
    return this.posts.preview(userId, dto);
  }
  @Post() create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePostDto,
  ) {
    // Through the app as a page: a person's hand (spec 045). The assistant calls the service.
    return this.posts.create(user.userId, dto, { byHand: !!user.actorId && user.actorId !== user.userId });
  }
  @Get() list(
    @CurrentUser('userId') userId: string,
    @Query() query: PostListDto,
  ) {
    return this.posts.list(userId, query);
  }
  /**
   * Declared before `:id` so "for-you" is never read as a post id. Ranked with `forYouRanking`
   * (#9), otherwise the newest-first feed.
   */
  @Get('for-you') forYou(
    @CurrentUser('userId') userId: string,
    @Query() query: ForYouDto,
  ) {
    return this.forYouFeed.page(userId, query);
  }
  /** The viewer's own For You interests and reset time (#10). Private; For You only. */
  @Get('for-you/preferences') forYouPreferences(@CurrentUser('userId') userId: string) {
    return this.forYouFeed.getPreferences(userId);
  }
  @Put('for-you/preferences') setForYouPreferences(
    @CurrentUser('userId') userId: string,
    @Body() dto: FeedPreferencesDto,
  ) {
    return this.forYouFeed.setInterests(userId, dto.interests);
  }
  /** "Reset recommendations": earlier likes, comments and reposts stop shaping For You. */
  @Post('for-you/reset') resetForYou(@CurrentUser('userId') userId: string) {
    return this.forYouFeed.resetRecommendations(userId);
  }
  /** Whether For You measurement (#11) runs for this account, and its opt-out. */
  @Get('for-you/metrics') metricsStatus(@CurrentUser('userId') userId: string) {
    return this.metrics.status(userId);
  }
  @Put('for-you/metrics') setMetricsOptOut(
    @CurrentUser('userId') userId: string,
    @Body() dto: FeedMetricsOptOutDto,
  ) {
    return this.metrics.setOptOut(userId, dto.optedOut);
  }
  /** Answers 2xx with what was counted; anything not countable is dropped, never an error. */
  @Post('for-you/metrics/events') recordMetrics(
    @CurrentUser('userId') userId: string,
    @Body() dto: FeedMetricsBatchDto,
  ) {
    return this.metrics.record(userId, dto);
  }
  /** Developer only: daily aggregates, never per account. */
  @Get('for-you/metrics/report') metricsReport(
    @CurrentUser('userId') userId: string,
    @Query() query: FeedMetricsReportDto,
  ) {
    return this.metrics.report(userId, query.range);
  }
  /** Spec 039, developer only: what waits for review, and the two decisions. */
  @Get('moderation') moderationQueue(@CurrentUser('userId') userId: string) {
    return this.moderation.queue(userId);
  }
  @Get('moderation/checks') moderationChecks(@CurrentUser('userId') userId: string) {
    return this.moderation.recentChecks(userId);
  }
  @Post('moderation/:postId/keep') @HttpCode(200) moderationKeep(
    @CurrentUser('userId') userId: string,
    @Param('postId') postId: string,
  ) {
    return this.moderation.keep(userId, postId);
  }
  @Delete('moderation/:postId') moderationRemove(
    @CurrentUser('userId') userId: string,
    @Param('postId') postId: string,
  ) {
    return this.moderation.remove(userId, postId);
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
  /** Spec 045: posts of pages this person saw (feed cards on screen, or opened). Counts only. */
  @Post('views') views(@CurrentUser('userId') userId: string, @Body() dto: PostViewsDto) {
    return this.insights.recordViews(userId, dto.ids);
  }
  /** Spec 045: a page pins one of its posts to the top of its profile. */
  @Put(':id/pin') pin(@CurrentUser('userId') userId: string, @Param('id') id: string) {
    return this.posts.setPinned(userId, id, true);
  }
  @Delete(':id/pin') unpin(@CurrentUser('userId') userId: string, @Param('id') id: string) {
    return this.posts.setPinned(userId, id, false);
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
  @Put(':id/repost') repost(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
  ) {
    return this.engagement.setRepost(userId, id, true);
  }
  @Delete(':id/repost') unrepost(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
  ) {
    return this.engagement.setRepost(userId, id, false);
  }
  @Get(':id/comments') comments(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Query('before') before?: string,
    @Query('limit') limit?: string,
  ) {
    return this.engagement.list(userId, id, before, limit ? Number(limit) : undefined);
  }
  /** The thread a comment sits in, for a notification that points at it. */
  @Get(':id/comments/:commentId') commentThread(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Param('commentId') commentId: string,
  ) {
    return this.engagement.thread(userId, id, commentId);
  }
  @Get(':id/comments/:commentId/replies') replies(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Param('commentId') commentId: string,
    @Query('before') before?: string,
    @Query('limit') limit?: string,
  ) {
    return this.engagement.replies(userId, id, commentId, before, limit ? Number(limit) : undefined);
  }
  @Post(':id/comments') addComment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AddPostCommentDto,
  ) {
    return this.engagement.add(user.userId, id, dto.text, dto.requestId, dto.id, dto.parentId, { byHand: !!user.actorId && user.actorId !== user.userId });
  }
  @Put(':id/comments/:commentId/like') likeComment(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Param('commentId') commentId: string,
  ) {
    return this.engagement.setCommentLike(userId, id, commentId, true);
  }
  @Delete(':id/comments/:commentId/like') unlikeComment(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Param('commentId') commentId: string,
  ) {
    return this.engagement.setCommentLike(userId, id, commentId, false);
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
  /** `?k=` is a link-only post's key: the right one opens the post to this account. */
  @Get(':id') detail(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Query('k') key?: string,
  ) {
    return this.posts.detail(userId, id, typeof key === 'string' ? key : undefined);
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
  /** Spec 036: what copying this post's Training attachment would do, and doing it. */
  @Get(':id/training-copy') trainingCopyPreview(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
  ) {
    return this.posts.trainingCopyPreview(userId, id);
  }
  @Post(':id/training-copy') trainingCopy(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: TrainingCopyDto,
  ) {
    return this.posts.trainingCopy(userId, id, dto);
  }
  /** For You feedback (issue #3, task A). Undo is the matching DELETE. */
  @Put(':id/not-interested') notInterested(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
  ) {
    return this.posts.feedFeedback(userId, id, 'post', true);
  }
  @Delete(':id/not-interested') undoNotInterested(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
  ) {
    return this.posts.feedFeedback(userId, id, 'post', false);
  }
  @Put(':id/hide-author') hideAuthor(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
  ) {
    return this.posts.feedFeedback(userId, id, 'author', true);
  }
  @Delete(':id/hide-author') unhideAuthor(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
  ) {
    return this.posts.feedFeedback(userId, id, 'author', false);
  }
  @Post(':id/report') report(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: ReportPostDto,
  ) {
    return this.posts.report(userId, id, dto);
  }
}
/**
 * The one unauthenticated posts route: link previews for public posts (spec 017). No module
 * guard (there is no user), and a fixed small shape from `PostsService.publicPreview()`.
 */
/** Spec 045: a page's insights, for its managers (as themselves, or as the page). */
@ForPages()
@UseInterceptors(SocialNoStore)
@Controller('page-insights')
class PageInsightsController {
  constructor(private readonly insights: PageInsightsService) {}
  @Get(':pageId')
  get(@CurrentUser() user: AuthenticatedUser, @Param('pageId') pageId: string) {
    // As the page, `userId` is the page; as a person, their own id. Either must manage it.
    return this.insights.insights(user.userId === pageId ? (user.actorId ?? user.userId) : user.userId, pageId);
  }
}

/**
 * Spec 046: a portal for someone without an account: the person's public modules and two newest
 * public posts, nothing else. The page shown around it covers the rest with a popup to join.
 */
@UseInterceptors(SocialNoStore)
@Controller('public/portals')
class PublicPortalController {
  constructor(
    private readonly social: SocialService,
    private readonly posts: PostsService,
  ) {}
  @Public()
  @Get(':username')
  async portal(@Param('username') username: string, @Query('today') today?: string): Promise<PublicPortal> {
    const day = typeof today === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(today) ? today : new Date().toISOString().slice(0, 10);
    const { userId, ...portal } = await this.social.publicPortal(username, day);
    return { ...portal, posts: await this.posts.latestPublicPreviews(userId, 2) };
  }
}

@UseInterceptors(SocialNoStore)
@Controller('public/posts')
class PublicPostsController {
  constructor(private readonly posts: PostsService) {}
  @Public()
  @Get(':id/preview')
  preview(@Param('id') id: string) {
    return this.posts.publicPreview(id);
  }
}
@Module({
  imports: [
    NutritionModule,
    TrainingModule,
    SocialModule,
    MailModule,
    MongooseModule.forFeature([
      { name: FoodPostRecord.name, schema: FoodPostSchema },
      { name: PostLikeRecord.name, schema: PostLikeSchema },
      { name: PostCommentLikeRecord.name, schema: PostCommentLikeSchema },
      { name: PostCommentRecord.name, schema: PostCommentSchema },
      { name: PostReportRecord.name, schema: PostReportSchema },
      { name: FeedFeedbackRecord.name, schema: FeedFeedbackSchema },
      { name: ForYouSessionRecord.name, schema: ForYouSessionSchema },
      { name: FeedPreferencesRecord.name, schema: FeedPreferencesSchema },
      { name: FeedMetricKeyRecord.name, schema: FeedMetricKeySchema },
      { name: FeedMetricsDailyRecord.name, schema: FeedMetricsDailySchema },
      { name: PostViewKeyRecord.name, schema: PostViewKeySchema },
      { name: PostViewsDailyRecord.name, schema: PostViewsDailySchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [PostsController, PublicPostsController, PageInsightsController, PublicPortalController],
  providers: [PostsService, PostEngagementService, ForYouService, FeedMetricsService, PostModerationService, PageInsightsService],
  // Messages renders shared posts through the same read authorization as opening one.
  exports: [PostsService, PostEngagementService, ForYouService, PageInsightsService],
})
export class PostsModule {}
