import 'dotenv/config';
import { Logger, ValidationPipe } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { McpOAuthService } from './mcp/oauth.service';
import { AppModule } from './app/app.module';
import { loadConfig } from './config/configuration';

async function bootstrap() {
  // Loaded before the Nest context so a missing variable fails immediately with a clear
  // message rather than midway through dependency injection.
  const config = loadConfig();

  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // A bounded Health batch can exceed Express's 100 kB default. DTOs still cap row counts.
  app.useBodyParser('json', { limit: '2mb' });
  app.setGlobalPrefix('api');
  const oauth = app.get(McpOAuthService);
  if (oauth.enabled) {
    // Render terminates TLS one proxy hop away. Never trust arbitrary forwarded hosts.
    app.getHttpAdapter().getInstance().set('trust proxy', 1);
    app.use(oauth.router());
  }

  // TEMP DEBUG — before Nest routing/guards
  app.use((req: Request, res: Response, next: NextFunction) => {
    Logger.log('[RAW HTTP]', {
      method: req.method,
      url: req.originalUrl,
      contentType: req.headers['content-type'],
      contentLength: req.headers['content-length'],
      hasHealthTicket: !!req.headers['x-health-ticket'],
    });

    next();
  });

  app.useGlobalPipes(
    new ValidationPipe({
      // `whitelist` plus `forbidNonWhitelisted` turn an unexpected field into a 400 rather
      // than silently dropping it, which catches renamed fields during refactors.
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
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
