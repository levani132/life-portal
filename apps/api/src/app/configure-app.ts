import { Logger, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Request, Response, NextFunction } from 'express';
import type { AppConfig } from '../config/configuration';
import { McpOAuthService } from '../mcp/oauth.service';
import { healthValidationException } from '../nutrition/health-validation';

/**
 * Everything `main.ts` does to the app between creating it and listening. Shared with the
 * integration tests (`integration/harness.ts`, issue #22) so they exercise the same prefix, body
 * parser, validation and CORS as production rather than a look-alike.
 */
export function configureApp(app: NestExpressApplication, config: AppConfig): void {
  app.setGlobalPrefix('api');
  const oauth = app.get(McpOAuthService);
  if (oauth.enabled) {
    // Render terminates TLS one proxy hop away. Never trust arbitrary forwarded hosts.
    app.getHttpAdapter().getInstance().set('trust proxy', 1);
    app.use(oauth.router());
  }

  // Trace only Health uploads; never log login bodies, credentials or health sample values.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path === '/api/nutrition/health/upload') {
      const started = Date.now();
      Logger.log(
        `received path=${req.path} method=${req.method} contentType=${req.headers['content-type'] ?? 'missing'} bytes=${req.headers['content-length'] ?? 'unknown'} hasTicket=${!!req.headers['x-health-ticket']}`,
        'HealthUpload',
      );
      res.on('finish', () =>
        Logger.log(
          `completed status=${res.statusCode} durationMs=${Date.now() - started}`,
          'HealthUpload',
        ),
      );
    }
    next();
  });

  // Trace receipt before JSON parsing, so malformed Shortcut bodies also have a status log.
  app.useBodyParser('json', { limit: '2mb' });

  app.useGlobalPipes(
    new ValidationPipe({
      // `whitelist` plus `forbidNonWhitelisted` turn an unexpected field into a 400 rather
      // than silently dropping it, which catches renamed fields during refactors.
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: healthValidationException,
    }),
  );

  app.enableCors({ origin: config.corsOrigins, credentials: true });
  app.enableShutdownHooks();
}
