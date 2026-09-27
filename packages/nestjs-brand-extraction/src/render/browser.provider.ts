import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Browser, chromium } from 'playwright-core';
import { BRAND_EXTRACTION_CONFIG, BrandExtractionConfig } from '../brand-extraction.config';

/**
 * One shared Chromium per process, launched lazily and relaunched if it dies.
 * Every extraction gets its own BrowserContext (isolated cookies/storage).
 */
@Injectable()
export class BrowserProvider implements OnModuleDestroy {
  private readonly logger = new Logger(BrowserProvider.name);
  private browser: Promise<Browser> | null = null;

  constructor(@Inject(BRAND_EXTRACTION_CONFIG) private readonly config: BrandExtractionConfig) {}

  get(): Promise<Browser> {
    if (!this.browser) {
      this.browser = chromium
        .launch({
          executablePath: this.config.chromiumExecutablePath,
          headless: true,
          args: [
            '--disable-dev-shm-usage',
            '--disable-extensions',
            '--disable-background-networking',
            '--disable-sync',
            '--mute-audio',
            '--no-first-run',
            '--disable-features=Translate,MediaRouter',
          ],
        })
        .then((b) => {
          b.on('disconnected', () => {
            this.logger.warn('Chromium disconnected; will relaunch on next request');
            this.browser = null;
          });
          return b;
        })
        .catch((err) => {
          this.browser = null;
          throw err;
        });
    }
    return this.browser;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.browser) await (await this.browser).close().catch(() => undefined);
  }
}
