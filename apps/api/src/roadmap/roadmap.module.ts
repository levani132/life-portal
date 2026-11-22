import { Controller, Get, Header, Module } from '@nestjs/common';
import type { Roadmap } from '@life-portal/shared-types';
import { AccessService } from '../access/access.module';
import { CurrentUser } from '../auth/current-user.decorator';
import { ROADMAP } from './roadmap.data';
import { AsPerson } from '../auth/acting';

/** The roadmap, for the developer account only: it holds plans and the business model. */
@AsPerson()
@Controller('roadmap')
export class RoadmapController {
  constructor(private readonly access: AccessService) {}

  @Get() @Header('Cache-Control', 'no-store') read(@CurrentUser('userId') userId: string): Roadmap {
    this.access.requireDeveloper(userId);
    return ROADMAP;
  }
}

@Module({ controllers: [RoadmapController] })
export class RoadmapModule {}
