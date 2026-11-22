import { Body, Controller, Get, Header, HttpCode, Inject, Injectable, Ip, Module, Post, Req, Res } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import type { Request, Response } from 'express';
import type { Connection } from 'mongoose';
import type { AccountExport, DeleteAccountRequest } from '@life-portal/shared-types';
import { AuthModule } from '../auth/auth.module';
import { CurrentUser } from '../auth/current-user.decorator';
import { SessionCookies } from '../auth/session-cookie';
import { CONFIG, type AppConfig } from '../config/configuration';
import { MailModule } from '../mail/mail.module';
import { ACCOUNT_STORE, AccountService, type AccountStore } from './account.service';
import { AsPerson } from '../auth/acting';

/** `AccountStore` on the real database, through the driver: no model, so no module is imported. */
@Injectable()
export class MongoAccountStore implements AccountStore {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  find(collection: string, filter: Record<string, unknown>, limit = 0) {
    return this.connection.collection(collection).find(filter).limit(limit).toArray() as Promise<Record<string, unknown>[]>;
  }

  async deleteMany(collection: string, filter: Record<string, unknown>) {
    return (await this.connection.collection(collection).deleteMany(filter)).deletedCount;
  }

  async updateMany(collection: string, filter: Record<string, unknown>, update: Record<string, unknown>, arrayFilters?: Record<string, unknown>[]) {
    await this.connection.collection(collection).updateMany(filter, update, arrayFilters ? { arrayFilters } : undefined);
  }
}

export class DeleteAccountDto implements DeleteAccountRequest {
  @IsOptional() @IsString() @MaxLength(200) password?: string;
  @IsOptional() @IsString() @MaxLength(320) confirmEmail?: string;
}

@AsPerson()
@Controller('account')
export class AccountController {
  private readonly cookies: SessionCookies;

  constructor(
    private readonly accounts: AccountService,
    @Inject(CONFIG) config: AppConfig,
  ) {
    this.cookies = new SessionCookies(config.corsOrigins, config.refreshTokenTtlSeconds);
  }

  /** Everything the signed-in account owns, as one JSON file. */
  @Get('export')
  @Header('Cache-Control', 'no-store')
  export(@CurrentUser('userId') userId: string, @Ip() ip: string): Promise<AccountExport> {
    return this.accounts.export(userId, { ip });
  }

  /** Deletes the signed-in account for good. A POST, so the confirmation travels in a body. */
  @Post('delete')
  @HttpCode(200)
  async delete(
    @CurrentUser('userId') userId: string,
    @Body() dto: DeleteAccountDto,
    @Ip() ip: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const done = await this.accounts.delete(userId, dto, { ip });
    this.cookies.clear(req, res);
    return done;
  }
}

@Module({
  imports: [AuthModule, MailModule],
  controllers: [AccountController],
  providers: [AccountService, { provide: ACCOUNT_STORE, useClass: MongoAccountStore }],
  exports: [AccountService],
})
export class AccountModule {}
