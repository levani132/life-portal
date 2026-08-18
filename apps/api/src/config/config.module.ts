import { Global, Module } from '@nestjs/common';
import { CONFIG, loadConfig } from './configuration';

/**
 * Provides the validated `AppConfig` under the `CONFIG` token.
 *
 * `@Global()` because configuration is genuinely cross-cutting: `FinnhubProvider`,
 * `AuthService`, `JwtStrategy` and the scheduled job all need it, and threading a
 * `ConfigModule` import through every feature module would be noise. Declaring it global here
 * is also what makes the token resolvable from a feature module at all — a provider declared
 * in `AppModule` is not visible to its imports.
 *
 * The factory runs once, so the environment is validated a single time at boot.
 */
@Global()
@Module({
  providers: [{ provide: CONFIG, useFactory: loadConfig }],
  exports: [CONFIG],
})
export class ConfigModule {}
