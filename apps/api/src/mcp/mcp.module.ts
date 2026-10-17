import { Body, Controller, Get, Module, Post, Query } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { CurrentUser, Public } from '../auth/current-user.decorator';
import { loadConfig } from '../config/configuration';
import { NutritionModule } from '../nutrition/nutrition.module';
import { McpService } from './mcp.service';
import { McpToolCallDto } from './mcp.dto';

/**
 * MCP (Model Context Protocol) server for AI assistants.
 *
 * Exposes nutrition tools so external AI apps (ChatGPT, Claude, etc.) can read and write
 * food data on behalf of the user. Authentication is via a long-lived MCP token that the
 * user generates from the settings page.
 */
@Controller('mcp')
export class McpController {
  constructor(private readonly mcp: McpService) {}

  /** Generate a long-lived MCP token for AI assistants. Requires normal JWT auth. */
  @Post('token')
  generateToken(@CurrentUser('userId') userId: string): { token: string; expiresAt: string } {
    return this.mcp.generateToken(userId);
  }

  /** List available tools. Public because the AI needs to discover them before auth. */
  @Public()
  @Get('tools')
  listTools() {
    return this.mcp.listTools();
  }

  /** Execute a tool. Auth via MCP token in the request body. */
  @Public()
  @Post('call')
  async callTool(@Body() dto: McpToolCallDto) {
    const userId = await this.mcp.verifyToken(dto.token);
    return this.mcp.callTool(userId, dto.tool, dto.arguments);
  }

  /** SSE endpoint for MCP protocol. */
  @Public()
  @Get('sse')
  async sse(@Query('token') token: string) {
    const userId = await this.mcp.verifyToken(token);
    return { userId, status: 'connected' };
  }
}

@Module({
  imports: [
    NutritionModule,
    JwtModule.register({ secret: loadConfig().jwtSecret }),
  ],
  controllers: [McpController],
  providers: [McpService],
  exports: [McpService],
})
export class McpModule {}
