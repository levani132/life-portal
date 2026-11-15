import type { Audience, ModuleId } from './portal';
import type { Id, IsoDate, Timestamped } from './common';

export interface User extends Timestamped {
  id: Id;
  email: string;
  name: string;
  roles: string[];
  /** ISO time the email was confirmed (issue #27); absent until then. Never required to sign in. */
  emailVerifiedAt?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  /** Access-token lifetime in seconds. */
  expiresIn: number;
}

export interface AuthSession extends AuthTokens {
  user: User;
}

export interface JwtPayload {
  sub: Id;
  email: string;
  roles: string[];
  /** Distinguishes access from refresh tokens so a refresh token cannot call data routes. */
  typ: 'access' | 'refresh';
  /**
   * The sign-in session (`auth_sessions` row) this token belongs to. Every token issued since
   * issue #27 carries one; a token without it is from before sessions existed and is refused.
   */
  sid?: Id;
  /** Random per token, so two tokens never share a hash (issue #27). */
  jti?: string;
  iat?: number;
  exp?: number;
}

/** `GET /auth/capabilities`: what works by email on this server (issue #27). */
export interface AuthCapabilities {
  passwordReset: boolean;
  emailVerification: boolean;
}

/** One signed-in device, as `GET /auth/sessions` lists it. */
export interface AuthSessionInfo {
  id: Id;
  /** A short label from the browser, e.g. "Safari on iPhone". */
  device: string;
  createdAt: string;
  lastUsedAt: string;
  /** The session the request came from. */
  current: boolean;
}

/**
 * Refusal codes from `POST /auth/refresh`. `REFRESH_SUPERSEDED` is not a sign-out: another tab
 * refreshed with the same token a moment ago, so the caller should pick up the new one.
 */
export type RefreshRefusal = 'LEGACY_SESSION' | 'SESSION_ENDED' | 'REFRESH_REUSED' | 'REFRESH_SUPERSEDED';

export interface RegisterRequest {
  email: string;
  password: string;
  name: string;
  /** Required when `REGISTRATION_INVITE_CODE` is configured. */
  inviteCode?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RefreshRequest {
  refreshToken: string;
}

export interface UserSettings extends Timestamped {
  id: Id;
  userId: Id;
  /** Currency used for dashboard roll-ups; per-record currencies are converted into it. */
  displayCurrency: string;
  /** Day of month the salary lands. Defaults to 7. */
  salaryDayOfMonth: number;
  /** Applied to modelled stock sale proceeds. 0 = no tax modelling. */
  capitalGainsTaxRate: number;
  /** 0 = Sunday .. 6 = Saturday. The budgeting week's boundary. */
  weekStartsOn: number;
  /** Day of month a *financial* month begins. 1 gives calendar months. */
  monthStartsOn: number;
  /** Budgeted expense ids in the order the spending ladder fills them. */
  spendOrder: string[];
  /**
   * @deprecated Superseded by the `fx` module and no longer read.
   *
   * A single snapshot cannot keep history stable: every past figure would re-value itself
   * whenever the lari moved. `fx_rate_history` archives a rate per day instead. Kept only so
   * existing documents still validate. See `docs/modules/fx.md`.
   */
  fxRates: Record<string, number>;
  /** @deprecated See `fxRates`. */
  fxRatesUpdatedAt?: IsoDate;
  /**
   * The user's dashboard arrangement: card ids in the order they dragged them into. Empty
   * means "however the widgets rank themselves". Ids the arrangement does not mention sort
   * after the ones it does — see `arrangeWidgets` in `libs/shared/domain`.
   */
  widgetOrder: string[];
  selectedModules?: ModuleId[];
  moduleVisibility?: Partial<Record<ModuleId, Audience>>;
  completedSetupSteps?: import('./portal').SetupStep[];
  setupStep?: number;
  setupCompleted?: boolean;
  setupDismissed?: boolean;
}
