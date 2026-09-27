# Backend proxy (NestJS)

The app backend is the only caller of brand-service. The code below is the
reference. Adapt the names to the repo's conventions (module layout, auth
guard, config service, error filter), but keep the behaviour.

## Env

```env
BRAND_SERVICE_URL=https://brand.example.internal     # no trailing slash
BRAND_SERVICE_API_KEY=...                            # this app's own key, backend only
```

Add both to the repo's env validation schema. The key is issued per app, and
the brand-service operator adds it to `BRAND_SERVICE_API_KEYS` as
`<app-name>:<key>`.

## Module

```ts
// brand/brand.module.ts
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createBrandClient } from '@wisemen/brand-kit';
import { BrandController } from './brand.controller';

export const BRAND_CLIENT = Symbol('BRAND_CLIENT');

@Module({
  controllers: [BrandController],
  providers: [
    {
      provide: BRAND_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        createBrandClient({
          baseUrl: `${config.getOrThrow<string>('BRAND_SERVICE_URL')}/v1/brand`,
          headers: () => ({ authorization: `Bearer ${config.getOrThrow<string>('BRAND_SERVICE_API_KEY')}` }),
          timeoutMs: 55_000,
        }),
    },
  ],
  exports: [BRAND_CLIENT],
})
export class BrandModule {}
```

## Controller

```ts
// brand/brand.controller.ts
import { Body, Controller, HttpCode, HttpException, Inject, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  BrandClient,
  BrandClientError,
  BrandExtractionResult,
  MonogramResponse,
} from '@wisemen/brand-kit';
import { z } from 'zod';
import { AuthGuard } from '../auth/auth.guard'; // ← the repo's existing guard
import { BRAND_CLIENT } from './brand.module';

const ExtractBody = z.object({
  website: z.string().min(3).max(300),
  companyName: z.string().min(1).max(120).optional(),
  force: z.boolean().optional(),
});
const MonogramBody = z.object({
  letters: z.string().regex(/^[\p{L}\p{N}]{1,3}$/u),
  background: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

@Controller('brand')
@UseGuards(AuthGuard)
export class BrandController {
  constructor(@Inject(BRAND_CLIENT) private readonly brand: BrandClient) {}

  /** Each call renders a website: keep a tight per-user limit. */
  @Post('extract')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  extract(@Body() body: unknown): Promise<BrandExtractionResult> {
    return this.forward(() => this.brand.extract(ExtractBody.parse(body)));
  }

  @Post('monogram')
  @HttpCode(200)
  monogram(@Body() body: unknown): Promise<MonogramResponse> {
    return this.forward(() => this.brand.monogram(MonogramBody.parse(body)));
  }

  /** Pass status + Dutch message through, except auth problems between services. */
  private async forward<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (err) {
      if (err instanceof z.ZodError) throw new HttpException(err.issues, 400);
      if (err instanceof BrandClientError) {
        if (err.kind === 'unauthorized') {
          // Misconfigured service key: an ops problem, not the user's.
          throw new HttpException('De merkanalyse is tijdelijk niet beschikbaar.', 503);
        }
        const status = err.status ?? (err.kind === 'timeout' ? 504 : 502);
        throw new HttpException(err.message, status);
      }
      throw err;
    }
  }
}
```

The Vue client in the browser then uses `createBrandClient({ baseUrl: '/api/brand', headers: authHeaders })`.
Its error kinds line up with these statuses.

## Storing the result

The step emits a `BrandStepResult` (see `@wisemen/brand-kit` →
`wizard.ts`):

```ts
{ primary: '#C8102E', accent: '#1F2937' | null,
  icon: { kind: 'monogram' | 'logo' | 'upload', mimeType: 'image/svg+xml' | 'image/png', dataUrl, background } }
```

On save (in the customer create/update use case):

1. **Validate.** Check that `primary` / `accent` match `^#[0-9A-F]{6}$`,
   that `mimeType` is one of the two allowed values, and that the decoded
   size is ≤ 2 MB.
2. **Decode** the data URL to a buffer. SVG data URLs are
   `encodeURIComponent`-encoded and PNGs are base64.
3. **Sanitise SVG** for every `image/svg+xml`. This covers uploads, and
   monograms too, for defence in depth:

   ```ts
   import createDOMPurify from 'dompurify';
   import { JSDOM } from 'jsdom';
   const DOMPurify = createDOMPurify(new JSDOM('').window);
   const clean = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } });
   ```

   Reject the file if `clean` no longer contains `<svg`.
4. **Store** it through the app's file module (S3 or similar) as
   `customers/<id>/icon.(svg|png)`. Keep `iconKind` and `iconBackground` on
   the customer.
5. **Optionally** also store a 512 px PNG rendition (`sharp(svgBuffer).png()`)
   for places that need a raster, like emails and PDFs.

Suggested customer fields: `brandPrimary`, `brandAccent` (nullable),
`iconFileId`, `iconKind`, `iconBackground`. Don't store the full
`BrandExtractionResult`. It holds large data URLs and diagnostics. The draft
keeps it until the wizard is completed.

## Tests (no network)

- Controller: inject a fake `BrandClient`. Assert the status mapping for
  `invalid-website` (422), `timeout` (504), `rate-limited` (429) and
  `unauthorized` (503).
- Persistence: one test per icon kind, plus a malicious SVG
  (`<svg><script>…</script></svg>`) that ends up script-free.
