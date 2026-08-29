import type { Id, IsoDate, Timestamped } from './common';

export interface User extends Timestamped {
  id: Id;
  email: string;
  name: string;
  roles: string[];
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
  iat?: number;
  exp?: number;
}

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
}
