import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: true });
  app.enableShutdownHooks(); // closes Chromium cleanly on SIGTERM
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
  Logger.log(`brand-service listening on :${port}`, 'Bootstrap');
}
bootstrap();
