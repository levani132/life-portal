import { ConflictException, Global, Injectable, Module } from '@nestjs/common';
import {
  InjectModel,
  MongooseModule,
  Prop,
  Schema,
  SchemaFactory,
} from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type {
  ConnectionAction,
  ConnectionList,
} from '@life-portal/shared-types';
import {
  connectionPair,
  relationshipFor,
  transitionAllowed,
} from '@life-portal/shared-domain';
import { baseSchemaOptions } from '../common/mongoose';
@Schema({ ...baseSchemaOptions, collection: 'social_connections' })
class SocialConnection {
  @Prop({ required: true, unique: true }) pair!: string;
  @Prop({ required: true, index: true }) lowId!: string;
  @Prop({ required: true, index: true }) highId!: string;
  @Prop({
    type: String,
    enum: ['none', 'pending', 'accepted'],
    default: 'none',
  })
  state!: 'none' | 'pending' | 'accepted';
  @Prop() requestedBy?: string;
  @Prop({ type: [String], default: [] }) blockedBy!: string[];
  @Prop({ type: [String], default: [] }) mutedBy!: string[];
}
const ConnectionSchema = SchemaFactory.createForClass(SocialConnection);
@Injectable()
export class SocialGraphService {
  constructor(
    @InjectModel(SocialConnection.name)
    private readonly connections: Model<SocialConnection>,
  ) {}
  async between(a: string, b: string) {
    return this.connections.findOne({ pair: connectionPair(a, b) }).lean();
  }
  async blockedUserIds(userId: string): Promise<string[]> {
    const rows = await this.connections
      .find({
        $or: [{ lowId: userId }, { highId: userId }],
        'blockedBy.0': { $exists: true },
      })
      .select('lowId highId')
      .lean();
    return rows.map((row) => (row.lowId === userId ? row.highId : row.lowId));
  }
  async isBlocked(a: string, b: string) {
    return !!(await this.between(a, b))?.blockedBy.length;
  }
  async wallAuthorIds(userId: string): Promise<string[]> {
    const rows = await this.connections.find({ $or: [{ lowId: userId }, { highId: userId }], state: 'accepted', 'blockedBy.0': { $exists: false }, mutedBy: { $ne: userId } }).select('lowId highId').lean();
    return rows.map((row) => row.lowId === userId ? row.highId : row.lowId);
  }
  async list(userId: string, kind: ConnectionList, skip: number) {
    const filter: Record<string, unknown> =
      kind === 'blocked'
        ? { blockedBy: userId }
        : {
            'blockedBy.0': { $exists: false },
            state: kind === 'friends' ? 'accepted' : 'pending',
            ...(kind === 'incoming'
              ? { requestedBy: { $ne: userId } }
              : kind === 'outgoing'
                ? { requestedBy: userId }
                : {}),
          };
    return this.connections
      .find({ $or: [{ lowId: userId }, { highId: userId }], ...filter })
      .sort({ updatedAt: -1, _id: 1 })
      .skip(skip)
      .limit(21)
      .lean();
  }
  async act(actor: string, target: string, action: ConnectionAction) {
    const pair = connectionPair(actor, target);
    const [lowId, highId] = [actor, target].sort();
    let row = await this.between(actor, target);
    if (!row) {
      if (action !== 'request' && action !== 'block')
        throw new ConflictException(
          'This connection changed. Refresh and try again.',
        );
      try {
        await this.connections.updateOne(
          { pair },
          {
            $setOnInsert: {
              pair,
              lowId,
              highId,
              state: 'none',
              blockedBy: [],
              mutedBy: [],
            },
          },
          { upsert: true },
        );
      } catch (error) {
        if ((error as { code?: number }).code !== 11000) throw error;
      }
      row = (await this.between(actor, target))!;
    }
    // Retries of an already-applied outgoing request are harmless; opposite requests never auto-accept.
    if (
      action === 'request' &&
      !row.blockedBy.length &&
      relationshipFor(row, actor, target) === 'outgoing'
    )
      return;
    if (!transitionAllowed(row, actor, action))
      throw new ConflictException(
        'This connection changed. Refresh and try again.',
      );
    const filter: Record<string, unknown> = { pair };
    let update: Record<string, unknown>;
    if (action === 'block')
      update = {
        $addToSet: { blockedBy: actor },
        $set: { state: 'none', mutedBy: [] },
        $unset: { requestedBy: '' },
      };
    else if (action === 'unblock') {
      filter['blockedBy'] = actor;
      update = { $pull: { blockedBy: actor } };
    } else {
      filter['blockedBy.0'] = { $exists: false };
      filter['state'] = row.state;
      if (row.state === 'pending') filter['requestedBy'] = row.requestedBy;
      if (action === 'request')
        update = { $set: { state: 'pending', requestedBy: actor } };
      else if (action === 'accept') update = { $set: { state: 'accepted' } };
      else if (action === 'mute' || action === 'unmute')
        update =
          action === 'mute'
            ? { $addToSet: { mutedBy: actor } }
            : { $pull: { mutedBy: actor } };
      else
        update = {
          $set: { state: 'none', mutedBy: [] },
          $unset: { requestedBy: '' },
        };
    }
    const changed = await this.connections.findOneAndUpdate(filter, update);
    if (!changed && action === 'request') {
      const latest = await this.between(actor, target);
      if (
        latest &&
        !latest.blockedBy.length &&
        relationshipFor(latest, actor, target) === 'outgoing'
      )
        return;
    }
    if (!changed)
      throw new ConflictException(
        'This connection changed. Refresh and try again.',
      );
  }
}
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SocialConnection.name, schema: ConnectionSchema },
    ]),
  ],
  providers: [SocialGraphService],
  exports: [SocialGraphService],
})
export class SocialGraphModule {}
