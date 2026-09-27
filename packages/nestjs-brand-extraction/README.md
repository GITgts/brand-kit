# @wisemen/nestjs-brand-extraction

The engine behind brand-service. Most apps should **not** import this
directly. Call brand-service through `@wisemen/brand-kit` instead
(see `skills/integrate-brand-step`). Import it in-process only when an app
cannot reach the service and you accept running Chromium in that app.

```ts
BrandExtractionModule.forRootAsync({
  inject: [ConfigService],
  useFactory: (c: ConfigService) => ({
    anthropicApiKey: c.get('ANTHROPIC_API_KEY'),
    monogramFontPath: c.get('BRAND_MONOGRAM_FONT_PATH'),
  }),
});
// then inject BRAND_EXTRACTOR and expose your own routes
```

## Pipeline

1. `normalizeWebsite` reduces the input to the homepage, and the SSRF guard checks it.
2. `PageRenderer` loads the page in Chromium (1440×900 @2x, nl-BE). It blocks
   trackers and consent tools, hides remaining cookie layers, runs
   `COLLECT_PAGE_SIGNALS`, takes the above-the-fold screenshot, and takes element
   screenshots of the top logo candidates.
3. Logo candidates are gathered from:
   - header elements, ranked by DOM score
   - the JSON-LD `Organization.logo`
   - the SVG favicon
   - the apple-touch-icon
   - manifest icons
   - `og:image` (low prior)

   Each one is rasterised to ~1024 px, trimmed, and checked for a solid
   backdrop / tile. Duplicates are removed with a dHash, and a logo that
   appears in several sources gets a score bonus. Combination marks are
   split into symbol crops.
4. `LogoJudge` sends up to 6 candidates to Claude vision, with forced tool use
   and zod validation. It returns `bestLogoId`, `bestSquareId`, a
   recommendation (`logo` | `monogram`) and a Dutch reason for the UI.
5. `scorePalette` clusters all colour evidence in OKLab and picks the primary,
   the accent (a second chromatic colour, or else a dark "ink" colour), and
   4–6 swatches.
6. Icons are generated in two forms:
   - A monogram SVG, with the letters as font outlines and optically centred.
     It is always WCAG AA, darkened in OKLCH if needed.
   - A 512 px square PNG made from the best logo, using a consistent safe zone
     and a smart backdrop.

## Deployment

- Base image: `mcr.microsoft.com/playwright:v1.x-noble` (match the
  `playwright-core` version), or install Chromium with
  `npx playwright install --with-deps chromium`.
- **Network isolation.** Chromium resolves DNS itself, so the request-level
  SSRF guard cannot fully prevent DNS rebinding. Run the API (or a dedicated
  renderer worker) in a network that has no route to internal ranges or cloud
  metadata (egress policy / separate namespace).
- Protect the endpoint with auth and a per-user rate limit
  (`@nestjs/throttler`, e.g. 10/min).

## Tuning

Collect ~30 real customer sites with the "correct" primary colour and icon
choice as a labelled set. Then tune `SOURCE_WEIGHTS`, `MERGE_DISTANCE` and the
DOM logo scoring against that set, rather than against intuition.
`diagnostics` contains everything you need to see why a site went wrong.

## Known limits

- Sites behind hard bot protection (Cloudflare challenge) are detected by their
  interstitial title. The service then falls back to conventional icon URLs
  (`fallback-without-browser` warning), and the wizard's manual upload covers
  the rest.
- BMP-only `.ico` favicons are ignored.
- The in-page script lives in a JS string (not TS) on purpose. Bundlers inject
  helpers that crash inside `page.evaluate`.
