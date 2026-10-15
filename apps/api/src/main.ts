import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { loadEnv } from './config/env';
import { rateLimitAuth, securityHeaders, originCheck } from './security/security';
async function bootstrap() {
  const env = loadEnv();
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api/v1');
  app.use(cookieParser());
  app.use(securityHeaders);
  app.use(originCheck);
  app.use(rateLimitAuth);
  app.enableCors({ origin: env.WEB_ORIGIN, credentials: true });
  await app.listen(env.PORT, '0.0.0.0');
  new Logger('Bootstrap').log(`ERPCloud API listening on :${env.PORT}`);
}
bootstrap();
