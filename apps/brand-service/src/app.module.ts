import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { BrandExtractionModule } from '@wisemen/nestjs-brand-extraction';
import { ApiKeyGuard } from './api-key.guard';
import { BrandController } from './brand.controller';
import { ClientThrottlerGuard } from './client-throttler.guard';
import { brandOptionsFromEnv, rateLimitPerMinute } from './env';
import { HealthController } from './health.controller';

@Module({
  imports: [
    BrandExtractionModule.forRootAsync({ useFactory: () => brandOptionsFromEnv() }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: rateLimitPerMinute() }]),
  ],
  controllers: [BrandController, HealthController],
  providers: [
    // Order matters: authenticate first, then rate-limit per authenticated app.
    { provide: APP_GUARD, useClass: ApiKeyGuard },
    { provide: APP_GUARD, useClass: ClientThrottlerGuard },
  ],
})
export class AppModule {}
