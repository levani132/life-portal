import { Body, Controller, Get, Global, Module, Post } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RequireModule } from '../access/access.module';
import { CurrentUser } from '../auth/current-user.decorator';
import { MediaUploadDto } from './media.dto';
import { MediaUploadRecord, MediaUploadSchema } from './media.schemas';
import { MediaService } from './media.service';

@RequireModule('postMedia')
@Controller('media')
class MediaController {
  constructor(private readonly media: MediaService) {}
  @Get('config') config(@CurrentUser('userId') userId: string) {
    return this.media.mediaConfig(userId);
  }
  @Post() upload(@CurrentUser('userId') userId: string, @Body() dto: MediaUploadDto) {
    return this.media.ticket(userId, dto);
  }
}

/**
 * Uploads for posts and food pictures. Global because both Posts and Nutrition attach files,
 * and Posts already imports Nutrition: a shared module keeps that one-directional.
 */
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MediaUploadRecord.name, schema: MediaUploadSchema },
    ]),
  ],
  controllers: [MediaController],
  providers: [MediaService],
  exports: [MediaService],
})
export class MediaModule {}
