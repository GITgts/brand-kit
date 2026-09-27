import {
  BadRequestException,
  Body,
  Controller,
  GatewayTimeoutException,
  HttpCode,
  Inject,
  Logger,
  Post,
  Req,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { BrandExtractionResult, MonogramResponse } from '@wisemen/brand-kit';
import {
  BRAND_EXTRACTION_CONFIG,
  BRAND_EXTRACTOR,
  BrandExtractionConfig,
  BrandExtractor,
  InvalidWebsiteError,
  TimeoutError,
  buildMonogramSvg,
} from '@wisemen/nestjs-brand-extraction';
import { z } from 'zod';
import type { AuthedRequest } from './api-key.guard';

const ExtractBody = z.object({
  website: z.string().min(3).max(300),
  companyName: z.string().min(1).max(120).optional(),
  force: z.boolean().optional(),
});

const MonogramBody = z.object({
  letters: z.string().regex(/^[\p{L}\p{N}]{1,3}$/u),
  background: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

/** Versioned public API of brand-service. Contract: @wisemen/brand-kit + docs/openapi.yaml. */
@Controller('v1/brand')
export class BrandController {
  private readonly logger = new Logger(BrandController.name);

  constructor(
    @Inject(BRAND_EXTRACTOR) private readonly extractor: BrandExtractor,
    @Inject(BRAND_EXTRACTION_CONFIG) private readonly config: BrandExtractionConfig,
  ) {}

  @Post('extract')
  @HttpCode(200)
  async extract(@Body() body: unknown, @Req() req: Partial<AuthedRequest> = {}): Promise<BrandExtractionResult> {
    const parsed = ExtractBody.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    const { website, companyName, force } = parsed.data;
    const started = Date.now();
    try {
      const result = await this.extractor.extract(website, { companyName, force });
      // One line per call: cost attribution per consuming app.
      this.logger.log(
        `extract client=${req.brandClient ?? '-'} domain=${result.domain} decidedBy=${result.diagnostics.decidedBy} ms=${Date.now() - started}`,
      );
      return result;
    } catch (err) {
      if (err instanceof InvalidWebsiteError) throw new UnprocessableEntityException(err.message);
      if (err instanceof TimeoutError) {
        throw new GatewayTimeoutException('De website reageerde te traag. Upload het logo manueel of probeer opnieuw.');
      }
      throw err;
    }
  }

  /** Final monogram asset: letters as outlines in the brand font, WCAG-AA colours. */
  @Post('monogram')
  @HttpCode(200)
  monogram(@Body() body: unknown): MonogramResponse {
    const parsed = MonogramBody.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    return buildMonogramSvg({
      letters: parsed.data.letters.toUpperCase(),
      background: parsed.data.background,
      fontPath: this.config.monogramFontPath,
    });
  }
}
