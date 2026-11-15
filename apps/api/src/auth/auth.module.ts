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
import { EmailVerificationService } from './email-verification.service';
import { MailModule } from '../mail/mail.module';
import { GoogleController } from './google/google.controller';
import { GoogleAuthService } from './google/google-auth.service';
import { GoogleOidc } from './google/google-oidc';
import { OAuthFlow, OAuthFlowSchema, UserIdentity, UserIdentitySchema } from './google/google.schemas';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: AuthSessionRecord.name, schema: AuthSessionSchema },
      { name: RateLimitCounter.name, schema: RateLimitCounterSchema },
      { name: SecurityEvent.name, schema: SecurityEventSchema },
      { name: EmailToken.name, schema: EmailTokenSchema },
      { name: OAuthFlow.name, schema: OAuthFlowSchema },
      { name: UserIdentity.name, schema: UserIdentitySchema },
    ]),
    MailModule,
    PassportModule,
    JwtModule.register({}),
  ],
  controllers: [AuthController, GoogleController],
  providers: [AuthService, JwtStrategy, SessionsService, SecurityService, EmailTokensService, PasswordResetService, EmailVerificationService, GoogleOidc, GoogleAuthService],
  exports: [AuthService, SessionsService, SecurityService, EmailVerificationService],
})
export class AuthModule {}
