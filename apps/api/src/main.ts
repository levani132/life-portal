import 'dotenv/config';
import { Logger, ValidationPipe } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { McpOAuthService } from './mcp/oauth.service';
import { healthValidationException } from './nutrition/health-validation';
import { AppModule } from './app/app.module';
import { loadConfig } from './config/configuration';

async function bootstrap() {
  // Loaded before the Nest context so a missing variable fails immediately with a clear
  // message rather than midway through dependency injection.
  const config = loadConfig();

  const app = await NestFactory.create<NestExpressApplication>(AppModule);
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
        `received method=${req.method} contentType=${req.headers['content-type'] ?? 'missing'} bytes=${req.headers['content-length'] ?? 'unknown'} hasTicket=${!!req.headers['x-health-ticket']}`,
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

  await app.listen(config.port);
  Logger.log(
    `Life Portal API listening on http://localhost:${config.port}/api`,
    'Bootstrap',
  );
  if (!config.finnhubApiKey) {
    Logger.warn(
      'FINNHUB_API_KEY is not set — share prices must be entered manually.',
      'Bootstrap',
    );
  }
}

bootstrap();
