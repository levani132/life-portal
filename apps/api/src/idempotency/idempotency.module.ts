import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import { IdempotencyKey, IdempotencyKeySchema } from './idempotency.schema';

/**
 * Spec 027: `Idempotency-Key` on any authenticated write. Global, so every module's writes are
 * retry-safe without opting in; a request without the header is untouched. See
 * `docs/modules/offline.md`.
 */
@Global()
@Module({
  imports: [MongooseModule.forFeature([{ name: IdempotencyKey.name, schema: IdempotencyKeySchema }])],
  providers: [{ provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor }],
})
export class IdempotencyModule {}
