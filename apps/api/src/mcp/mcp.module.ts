import { AccessService, RequireModule } from '../access/access.module';
import {
  All,
  Body,
  Controller,
  Get,
  Header,
  Headers,
  Param,
  Put,
  Module,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { McpOAuthService } from './oauth.service';
import {
  McpOAuthClient,
  McpOAuthClientSchema,
  McpOAuthCredential,
  McpOAuthCredentialSchema,
} from './oauth.schema';
import { JwtModule } from '@nestjs/jwt';
import type { Request, Response } from 'express';
import { CurrentUser, Public, TokenAuth } from '../auth/current-user.decorator';
import { loadConfig } from '../config/configuration';
import { ProgrammesModule } from '../programmes/programmes.module';
import { NutritionModule } from '../nutrition/nutrition.module';
import { NutritionService } from '../nutrition/nutrition.service';
import { McpService } from './mcp.service';
import { McpToolCallDto } from './mcp.dto';
import { handleMcpRequest } from './mcp-protocol';
import { AsPerson } from '../auth/acting';
import { MediaModule } from '../media/media.module';
import { MessagesModule } from '../messages/messages.module';
import { PostsModule } from '../posts/posts.module';
import { SocialModule } from '../social/social.module';
import { TrainingModule } from '../training/training.module';
import { AssistantSettings, AssistantSettingsSchema, PageScheduledAction, PageScheduledActionSchema, PageAssistantAction, PageAssistantActionSchema, PageAssistantService, parseCaps } from './page-assistant';
import { PagesService } from '../pages/pages.module';
import type { AssistantActivity, AssistantCaps, AssistantOverview } from '@life-portal/shared-types';

/**
 * MCP (Model Context Protocol) server for AI assistants.
 *
 * Exposes nutrition tools so external AI apps (ChatGPT, Claude, etc.) can read and write
 * food data on behalf of the user. Supports OAuth sign-in and legacy MCP tokens
 * generated from the settings page.
 */
@Controller('mcp')
export class McpController {
  constructor(
    private readonly mcp: McpService,
    private readonly access: AccessService,
    private readonly nutrition: NutritionService,
    private readonly oauth: McpOAuthService,
    private readonly pageAssistant: PageAssistantService,
  ) {}

  /** Generate a long-lived MCP token for AI assistants. Requires normal JWT auth. */
  @RequireModule('nutrition')
  @Post('token')
  generateToken(@CurrentUser('userId') userId: string): {
    token: string;
    expiresAt: string;
  } {
    return this.mcp.generateToken(userId);
  }

  @Get('oauth/status')
  oauthStatus() {
    return { enabled: this.oauth.enabled };
  }

  @Post('oauth/revoke')
  revokeOAuth(@CurrentUser('userId') userId: string) {
    return this.oauth.revokeUser(userId);
  }

  /** List available tools. Public because the AI needs to discover them before auth. */
  @Public()
  @Get('tools')
  listTools() {
    return this.mcp.listTools();
  }

  /** OpenAPI schema for ChatGPT Actions. */
  @Public()
  @Get('openapi.json')
  openApiSchema(@Req() req: Request) {
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.get('host');
    const baseUrl = `${protocol}://${host}/api/mcp`;
    return this.mcp.openApiSchema(baseUrl);
  }

  /**
   * Execute a tool.
   * Auth via either:
   * - Authorization: Bearer <token> header (ChatGPT, standard OAuth)
   * - token field in request body (MCP protocol)
   */
  @TokenAuth()
  @Post('call')
  async callTool(
    @Headers('authorization') authHeader: string | undefined,
    @Body() dto: McpToolCallDto,
  ) {
    const token = this.extractToken(authHeader) ?? dto.token;
    const userId = await this.verifyCredential(token);
    return this.mcp.callTool(userId, dto.tool, dto.arguments ?? {});
  }

  /** Extract Bearer token from Authorization header. */
  private extractToken(authHeader: string | undefined): string | undefined {
    if (!authHeader?.startsWith('Bearer ')) return undefined;
    return authHeader.slice(7);
  }

  /** SSE endpoint for MCP protocol. */
  @TokenAuth()
  @Get('sse')
  async sse(@Query('token') token: string) {
    const userId = await this.mcp.verifyToken(token);
    await this.access.require(userId, 'nutrition');
    return { userId, status: 'connected' };
  }

  /**
   * MCP Protocol endpoint (Streamable HTTP).
   * Handles POST (JSON-RPC), GET (SSE), DELETE (session termination).
   * This is the standards-compliant MCP endpoint for ChatGPT and other MCP clients.
   */
  @TokenAuth()
  @All()
  async mcpProtocol(@Req() req: Request, @Res() res: Response) {
    await handleMcpRequest(
      req as never,
      res as never,
      this.nutrition,
      async (token) => {
        const userId = await this.verifyCredential(token);
        await this.access.require(userId, 'nutrition');
        return userId;
      },
      this.oauth.enabled ? this.oauth.metadataUrl : undefined,
      this.pageAssistant.tools(),
    );
  }
  private async verifyCredential(token: string | undefined): Promise<string> {
    if (this.oauth.enabled && token) {
      try {
        const info = await this.oauth.verifyAccessToken(token);
        return info.extra?.['userId'] as string;
      } catch {
        // Legacy signed MCP tokens remain supported, with their own type check.
      }
    }
    return this.mcp.verifyToken(token ?? '');
  }
}

/**
 * Spec 041: the assistant's caps (the owner's defaults and one person's override) and what the
 * assistant did as a page, for its managers. Signed-in routes; the assistant itself has tools.
 */
@AsPerson()
@Controller('page-assistant')
export class PageAssistantController {
  constructor(
    private readonly assistant: PageAssistantService,
    private readonly pages: PagesService,
    private readonly access: AccessService,
  ) {}

  @Get('caps')
  caps(@CurrentUser('userId') userId: string): Promise<AssistantCaps> {
    this.access.requireDeveloper(userId);
    return this.assistant.defaults();
  }

  @Put('caps')
  setCaps(@CurrentUser('userId') userId: string, @Body() body: { caps?: unknown }): Promise<AssistantCaps> {
    return this.assistant.setDefaults(userId, parseCaps(body?.caps, false) as AssistantCaps);
  }

  /** `caps: null` returns the person to the defaults; a partial object overrides only those kinds. */
  @Put('caps/:personId')
  setPersonCaps(@CurrentUser('userId') userId: string, @Param('personId') personId: string, @Body() body: { caps?: unknown }) {
    return this.pages.setAssistantCaps(userId, personId, body?.caps === null ? null : parseCaps(body?.caps, true));
  }

  /** Every page the person manages: what the assistant did today, what waits, what failed. */
  @Get('overview')
  @Header('Cache-Control', 'no-store')
  overview(@CurrentUser('userId') userId: string): Promise<AssistantOverview> {
    return this.assistant.overview(userId);
  }

  /** The owner marks every page they manage as the app's own, in one go. */
  @Put('official')
  officialAll(@CurrentUser('userId') userId: string) {
    return this.pages.markMineOfficial(userId);
  }

  @Get('activity/:pageId')
  @Header('Cache-Control', 'no-store')
  activity(@CurrentUser('userId') userId: string, @Param('pageId') pageId: string): Promise<AssistantActivity> {
    return this.assistant.activity(userId, pageId);
  }
}

@Module({
  imports: [
    NutritionModule,
    ProgrammesModule,
    AuthModule,
    PostsModule,
    MediaModule,
    TrainingModule,
    MessagesModule,
    SocialModule,
    MongooseModule.forFeature([
      { name: PageAssistantAction.name, schema: PageAssistantActionSchema },
      { name: AssistantSettings.name, schema: AssistantSettingsSchema },
      { name: PageScheduledAction.name, schema: PageScheduledActionSchema },
      { name: McpOAuthClient.name, schema: McpOAuthClientSchema },
      { name: McpOAuthCredential.name, schema: McpOAuthCredentialSchema },
    ]),
    JwtModule.register({ secret: loadConfig().jwtSecret }),
  ],
  controllers: [McpController, PageAssistantController],
  providers: [McpService, McpOAuthService, PageAssistantService],
  exports: [McpService, McpOAuthService],
})
export class McpModule {}
