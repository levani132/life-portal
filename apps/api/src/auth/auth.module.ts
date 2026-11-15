import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { User, UserSchema } from './schemas/user.schema';
import { AuthSessionRecord, AuthSessionSchema } from './schemas/auth-session.schema';
import { SessionsService } from './sessions.service';
import { RateLimitCounter, RateLimitCounterSchema, SecurityEvent, SecurityEventSchema } from './security/security.schemas';
import { SecurityService } from './security/security.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: AuthSessionRecord.name, schema: AuthSessionSchema },
      { name: RateLimitCounter.name, schema: RateLimitCounterSchema },
      { name: SecurityEvent.name, schema: SecurityEventSchema },
    ]),
    PassportModule,
    JwtModule.register({}),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, SessionsService, SecurityService],
  exports: [AuthService, SessionsService, SecurityService],
})
export class AuthModule {}
