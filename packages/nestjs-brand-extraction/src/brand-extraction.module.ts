import { DynamicModule, Module, ModuleMetadata, Provider } from '@nestjs/common';
import {
  BRAND_EXTRACTION_CONFIG,
  BrandExtractionOptions,
  resolveBrandExtractionConfig,
} from './brand-extraction.config';
import { BRAND_EXTRACTOR, BrandExtractionService } from './brand-extraction.service';
import { LogoJudge } from './logo/logo-judge';
import { BrowserProvider } from './render/browser.provider';
import { PageRenderer } from './render/page-renderer';

export interface BrandExtractionAsyncOptions extends Pick<ModuleMetadata, 'imports'> {
  inject?: any[];
  useFactory: (...args: any[]) => BrandExtractionOptions | Promise<BrandExtractionOptions>;
}

/**
 * In-process brand extraction. Registers no HTTP routes: the host decides
 * how to expose it (brand-service does; most apps should call brand-service
 * instead of importing this and shipping Chromium themselves).
 *
 *   BrandExtractionModule.forRootAsync({
 *     inject: [ConfigService],
 *     useFactory: (c: ConfigService) => ({ anthropicApiKey: c.get('ANTHROPIC_API_KEY') }),
 *   })
 */
@Module({})
export class BrandExtractionModule {
  static forRoot(options: BrandExtractionOptions = {}): DynamicModule {
    return this.build({ provide: BRAND_EXTRACTION_CONFIG, useValue: resolveBrandExtractionConfig(options) });
  }

  static forRootAsync(options: BrandExtractionAsyncOptions): DynamicModule {
    return this.build(
      {
        provide: BRAND_EXTRACTION_CONFIG,
        inject: options.inject ?? [],
        useFactory: async (...args: any[]) => resolveBrandExtractionConfig(await options.useFactory(...args)),
      },
      options.imports,
    );
  }

  private static build(config: Provider, imports: ModuleMetadata['imports'] = []): DynamicModule {
    return {
      module: BrandExtractionModule,
      imports,
      providers: [
        config,
        BrowserProvider,
        PageRenderer,
        LogoJudge,
        BrandExtractionService,
        { provide: BRAND_EXTRACTOR, useExisting: BrandExtractionService },
      ],
      exports: [BRAND_EXTRACTOR, BrandExtractionService, BRAND_EXTRACTION_CONFIG],
    };
  }
}
