import 'dotenv/config';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';
import { loadConfig } from './config/configuration';

async function bootstrap() {
  // Loaded before the Nest context so a missing variable fails immediately with a clear
  // message rather than midway through dependency injection.
  const config = loadConfig();

  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');

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
  Logger.log(`Life Portal API listening on http://localhost:${config.port}/api`, 'Bootstrap');
  if (!config.finnhubApiKey) {
    Logger.warn('FINNHUB_API_KEY is not set — share prices must be entered manually.', 'Bootstrap');
  }
}

bootstrap();
