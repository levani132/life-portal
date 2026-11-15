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
import { EmailToken, EmailTokenSchema } from './schemas/email-token.schema';
import { EmailTokensService } from './email-tokens.service';
import { PasswordResetService } from './password-reset.service';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: AuthSessionRecord.name, schema: AuthSessionSchema },
      { name: RateLimitCounter.name, schema: RateLimitCounterSchema },
      { name: SecurityEvent.name, schema: SecurityEventSchema },
      { name: EmailToken.name, schema: EmailTokenSchema },
    ]),
    MailModule,
    PassportModule,
    JwtModule.register({}),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, SessionsService, SecurityService, EmailTokensService, PasswordResetService],
  exports: [AuthService, SessionsService, SecurityService],
})
export class AuthModule {}
