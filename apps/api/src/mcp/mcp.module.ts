import {
  All,
  Body,
  Controller,
  Get,
  Headers,
  Module,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { McpOAuthService } from './oauth.service';
import { McpOAuthClient, McpOAuthClientSchema, McpOAuthCredential, McpOAuthCredentialSchema } from './oauth.schema';
import { JwtModule } from '@nestjs/jwt';
import type { Request, Response } from 'express';
import { CurrentUser, Public, TokenAuth } from '../auth/current-user.decorator';
import { loadConfig } from '../config/configuration';
import { NutritionModule } from '../nutrition/nutrition.module';
import { NutritionService } from '../nutrition/nutrition.service';
import { McpService } from './mcp.service';
import { McpToolCallDto } from './mcp.dto';
import { handleMcpRequest } from './mcp-protocol';

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
    private readonly nutrition: NutritionService,
    private readonly oauth: McpOAuthService,
  ) {}

  /** Generate a long-lived MCP token for AI assistants. Requires normal JWT auth. */
  @Post('token')
  generateToken(@CurrentUser('userId') userId: string): { token: string; expiresAt: string } {
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
      (token) => this.verifyCredential(token),
      this.oauth.enabled ? this.oauth.metadataUrl : undefined,
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

@Module({
  imports: [
    NutritionModule,
    AuthModule,
    MongooseModule.forFeature([
      { name: McpOAuthClient.name, schema: McpOAuthClientSchema },
      { name: McpOAuthCredential.name, schema: McpOAuthCredentialSchema },
    ]),
    JwtModule.register({ secret: loadConfig().jwtSecret }),
  ],
  controllers: [McpController],
  providers: [McpService, McpOAuthService],
  exports: [McpService, McpOAuthService],
})
export class McpModule {}
