import {
  Body,
  Controller,
  Delete,
  Get,
  Module,
  Param,
  Patch,
  Post,
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
  constructor(private readonly posts: PostsService) {}
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
      { name: PostReportRecord.name, schema: PostReportSchema },
    ]),
  ],
  controllers: [PostsController],
  providers: [PostsService],
})
export class PostsModule {}
