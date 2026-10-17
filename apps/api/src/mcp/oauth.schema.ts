import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

/** Registration survives deploys. Credentials are only returned by SDK auth handlers. */
@Schema({ collection: 'mcp_oauth_clients' })
export class McpOAuthClient {
  @Prop({ required: true, unique: true }) clientId!: string;
  @Prop({ required: true }) metadata!: string;
}
export const McpOAuthClientSchema = SchemaFactory.createForClass(McpOAuthClient);

/** Only hashes of browser tickets, authorization codes and bearer credentials are stored. */
@Schema({ collection: 'mcp_oauth_credentials' })
export class McpOAuthCredential {
  @Prop({ required: true, unique: true }) key!: string;
  @Prop({ required: true, enum: ['pending', 'code', 'access', 'refresh'] }) kind!: string;
  @Prop({ required: true }) clientId!: string;
  @Prop() userId?: string;
  @Prop() grantId?: string;
  @Prop({ type: [String], required: true }) scopes!: string[];
  @Prop({ required: true }) resource!: string;
  @Prop() redirectUri?: string;
  @Prop() codeChallenge?: string;
  @Prop() state?: string;
  @Prop() browserHash?: string;
  @Prop({ required: true }) expiresAt!: Date;
}
export const McpOAuthCredentialSchema = SchemaFactory.createForClass(McpOAuthCredential);
McpOAuthCredentialSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
McpOAuthCredentialSchema.index({ userId: 1, grantId: 1 });
