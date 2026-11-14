import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app/app.module';
import { configureApp } from './app/configure-app';
import { loadConfig } from './config/configuration';

async function bootstrap() {
  // Loaded before the Nest context so a missing variable fails immediately with a clear
  // message rather than midway through dependency injection.
  const config = loadConfig();

  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureApp(app, config);

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
