import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

/**
 * Two collections (docs/modules/messages.md). Nothing derived is stored: the inbox order, last
 * message, unread counts and "Seen" are all worked out on read from these rows.
 */

/** One member's own state in a conversation. */
export class ConversationMember {
  userId!: string;
  lastReadAt?: Date;
  /** Last sync while the conversation was on screen; drives notification suppression. */
  viewingAt?: Date;
  muted?: boolean;
}

@Schema({ collection: 'conversations', timestamps: true, versionKey: false })
export class Conversation {
  @Prop({ type: String, enum: ['direct'], required: true }) kind!: 'direct';
  /** Sorted member IDs, so a pair has exactly one direct conversation. */
  @Prop() pair?: string;
  @Prop({ type: [String], required: true, index: true }) memberIds!: string[];
  @Prop({
    type: [
      {
        _id: false,
        userId: { type: String, required: true },
        lastReadAt: Date,
        viewingAt: Date,
        muted: Boolean,
      },
    ],
    required: true,
  })
  members!: ConversationMember[];
  createdAt!: Date;
}
export const ConversationSchema = SchemaFactory.createForClass(Conversation);
ConversationSchema.index(
  { pair: 1 },
  { unique: true, partialFilterExpression: { kind: 'direct' } },
);

@Schema({ collection: 'messages', versionKey: false })
export class Message {
  @Prop({ required: true }) conversationId!: string;
  @Prop({ required: true }) senderId!: string;
  @Prop({ required: true }) requestId!: string;
  @Prop({ type: String, enum: ['text', 'post'], required: true }) kind!: 'text' | 'post';
  @Prop({ maxlength: 2000 }) text?: string;
  @Prop() postId?: string;
  @Prop() unsentAt?: Date;
  @Prop({ required: true }) createdAt!: Date;
}
export const MessageSchema = SchemaFactory.createForClass(Message);
MessageSchema.index({ conversationId: 1, senderId: 1, requestId: 1 }, { unique: true });
// Pages, "last message" and unread counts all scan one conversation newest first.
MessageSchema.index({ conversationId: 1, _id: -1 });
MessageSchema.index({ senderId: 1, createdAt: -1 });
