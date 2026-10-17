import { IsObject, IsOptional, IsString } from 'class-validator';

export class McpToolCallDto {
  @IsOptional() @IsString() token?: string;
  @IsString() tool!: string;
  @IsOptional() @IsObject() arguments?: Record<string, unknown>;
}
