import { IsObject, IsOptional, IsString } from 'class-validator';

export class McpToolCallDto {
  @IsString() token!: string;
  @IsString() tool!: string;
  @IsOptional() @IsObject() arguments?: Record<string, unknown>;
}
