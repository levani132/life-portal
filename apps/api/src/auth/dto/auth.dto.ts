import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(10, { message: 'Use at least 10 characters — this guards your financial data.' })
  @MaxLength(200)
  password!: string; // and `passwordProblem()`: at most 72 bytes, not common (issue #27)

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  inviteCode?: string;
}

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}

export class RefreshDto {
  /** Absent when the web sends it as the `lp_refresh` cookie instead (issue #29). */
  @IsOptional()
  @IsString()
  @MinLength(1)
  refreshToken?: string;
}

export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  currentPassword!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(200)
  newPassword!: string;
}

export class ForgotPasswordDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export class ResetTokenDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  token!: string;
}

export class ResetPasswordDto extends ResetTokenDto {
  @IsString()
  @MinLength(10)
  @MaxLength(200)
  password!: string;
}

/** Issue #28. Secrets the web app holds are base64url; nothing else is accepted. */
export class GoogleExchangeDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{20,200}$/)
  code!: string;

  @IsString()
  @Matches(/^[A-Za-z0-9_-]{20,200}$/)
  binding!: string;
}

export class GoogleLinkPasswordDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{20,200}$/)
  ticket!: string;

  @IsString()
  @Matches(/^[A-Za-z0-9_-]{20,200}$/)
  binding!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password!: string;
}

export class GoogleSignupDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{20,200}$/)
  ticket!: string;

  @IsString()
  @Matches(/^[A-Za-z0-9_-]{20,200}$/)
  binding!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  inviteCode?: string;
}
