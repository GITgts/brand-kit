import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BadRequestException, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { resolveBrandExtractionConfig } from '@wisemen/nestjs-brand-extraction';
import { ApiKeyGuard } from '../src/api-key.guard';
import { BrandController } from '../src/brand.controller';

const FONT = '/usr/share/fonts/truetype/google-fonts/Poppins-Bold.ttf';

describe('BrandController.monogram', () => {
  const controller = new BrandController(
    { extract: async () => { throw new Error('unused'); } },
    resolveBrandExtractionConfig({ monogramFontPath: FONT }),
  );

  it('returns an outline SVG with readable colours', () => {
    const m = controller.monogram({ letters: 'br', background: '#C8102E' });
    assert.match(m.svg, /<path d="M/);
    assert.equal(m.background, '#C8102E');
    assert.equal(m.foreground, '#FFFFFF');
  });

  it('rejects invalid input', () => {
    assert.throws(() => controller.monogram({ letters: '<script>', background: '#C8102E' }), BadRequestException);
    assert.throws(() => controller.monogram({ letters: 'BR', background: 'red' }), BadRequestException);
  });
});

describe('ApiKeyGuard', () => {
  process.env.BRAND_SERVICE_API_KEYS = 'wiseos:k_wise_123, taxi:k_taxi_456';
  const guard = new ApiKeyGuard(new Reflector());
  const ctx = (headers: Record<string, string>) => {
    const req: any = { headers };
    return {
      req,
      context: {
        getHandler: () => () => undefined,
        getClass: () => class {},
        switchToHttp: () => ({ getRequest: () => req }),
      } as unknown as ExecutionContext,
    };
  };

  it('identifies the calling app', () => {
    const { req, context } = ctx({ authorization: 'Bearer k_taxi_456' });
    assert.equal(guard.canActivate(context), true);
    assert.equal(req.brandClient, 'taxi');
    assert.equal(guard.canActivate(ctx({ 'x-api-key': 'k_wise_123' }).context), true);
  });

  it('rejects missing and wrong keys', () => {
    assert.throws(() => guard.canActivate(ctx({}).context), UnauthorizedException);
    assert.throws(() => guard.canActivate(ctx({ authorization: 'Bearer nope' }).context), UnauthorizedException);
  });

  it('refuses to start without keys', () => {
    process.env.BRAND_SERVICE_API_KEYS = '';
    assert.throws(() => new ApiKeyGuard(new Reflector()), /refusing to start/);
    process.env.BRAND_SERVICE_API_KEYS = 'wiseos:k_wise_123';
  });
});
