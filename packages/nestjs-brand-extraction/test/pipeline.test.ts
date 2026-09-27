import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import sharp from 'sharp';
import { JSDOM } from 'jsdom';
import { BrandExtractionConfig } from '../src/brand-extraction.config';
import { BrandExtractionService } from '../src/brand-extraction.service';
import { PageSignals, RenderedPage } from '../src/brand-extraction.types';
import { extractImagePalette } from '../src/color/image-palette';
import { deltaEOK, parseCssColor } from '@wisemen/brand-kit';
import { buildMonogramSvg } from '../src/icon/monogram';
import { composeSquareIcon } from '../src/icon/square-icon';
import { analyzeLogo, findSymbolCrops, rasterize } from '../src/logo/logo-analysis';
import { LogoJudge } from '../src/logo/logo-judge';
import { PageRenderer } from '../src/render/page-renderer';
import { COLLECT_PAGE_SIGNALS } from '../src/render/collect-page-signals.script';

const OUT = '/home/claude/bx/test-output';
mkdirSync(OUT, { recursive: true });
const FONT = '/usr/share/fonts/truetype/google-fonts/Poppins-Bold.ttf';

// ---------------------------------------------------------------------------
// Synthetic brand assets
// ---------------------------------------------------------------------------

const COMBINATION_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="120" viewBox="0 0 600 120">
  <circle cx="60" cy="60" r="52" fill="#C8102E"/><path d="M40 35h30a15 15 0 0 1 0 30H40zM40 65h34a15 15 0 0 1 0 30H40z" fill="#fff"/>
  <text x="140" y="82" font-family="Poppins" font-weight="700" font-size="62" fill="#1F2937">BRANTANO</text></svg>`;

const WORDMARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="100" viewBox="0 0 520 100">
  <text x="10" y="75" font-family="Poppins" font-weight="700" font-size="72" fill="#C8102E">BRANTANO</text></svg>`;

const BADGE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180">
  <rect width="180" height="180" fill="#C8102E"/><text x="90" y="118" text-anchor="middle" font-family="Poppins" font-weight="700" font-size="88" fill="#fff">BR</text></svg>`;

const HOMEPAGE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="900">
  <rect width="1440" height="900" fill="#FFFFFF"/>
  <rect width="1440" height="96" fill="#1F2937"/>
  <rect x="80" y="160" width="620" height="420" fill="#E8DFD0"/>
  <rect x="760" y="160" width="600" height="420" fill="#6B8F71"/>
  <rect x="80" y="620" width="220" height="56" rx="8" fill="#C8102E"/>
  <rect x="320" y="620" width="220" height="56" rx="8" fill="#C8102E"/>
  <rect x="0" y="740" width="1440" height="160" fill="#F5F5F4"/></svg>`;

const svgToPng = (svg: string) => sharp(Buffer.from(svg)).png().toBuffer();

// ---------------------------------------------------------------------------

describe('image pipeline', () => {
  it('extracts area-weighted palettes deterministically', async () => {
    const png = await svgToPng(HOMEPAGE_SVG);
    const a = await extractImagePalette(png, { k: 8 });
    const b = await extractImagePalette(png, { k: 8 });
    assert.deepEqual(a, b);
    assert.ok(deltaEOK(a[0].rgb, { r: 255, g: 255, b: 255 }) < 0.02, 'white dominates');
    assert.ok(a.some((p) => deltaEOK(p.rgb, parseCssColor('#C8102E')!) < 0.03), 'finds the small red buttons');
  });

  it('rasterises SVG and detects solid backdrops', async () => {
    const badge = await analyzeLogo((await rasterize(Buffer.from(BADGE_SVG), 'image/svg+xml'))!);
    assert.equal(badge!.backgroundHex, '#C8102E');
    assert.equal(badge!.isTile, true);
    assert.ok(Math.abs(badge!.aspect - 1) < 0.05);

    const combo = await analyzeLogo((await rasterize(Buffer.from(COMBINATION_SVG), 'image/svg+xml'))!);
    assert.equal(combo!.backgroundHex, null);
    assert.equal(combo!.hasTransparency, true);
    assert.ok(combo!.aspect > 3);
  });

  it('splits the symbol off a combination mark, but not off a wordmark', async () => {
    const combo = (await analyzeLogo((await rasterize(Buffer.from(COMBINATION_SVG), 'image/svg+xml'))!))!;
    const crops = await findSymbolCrops(combo);
    assert.equal(crops.length, 1);
    assert.equal(crops[0].layout, 'symbol-left');
    const m = await sharp(crops[0].png).metadata();
    assert.ok(Math.abs(m.width! / m.height! - 1) < 0.1, 'crop is the round symbol');
    writeFileSync(`${OUT}/symbol-crop.png`, crops[0].png);

    const word = (await analyzeLogo((await rasterize(Buffer.from(WORDMARK_SVG), 'image/svg+xml'))!))!;
    assert.equal((await findSymbolCrops(word)).length, 0);
  });

  it('builds uniform square icons', async () => {
    const combo = (await analyzeLogo((await rasterize(Buffer.from(COMBINATION_SVG), 'image/svg+xml'))!))!;
    const sq = await composeSquareIcon(combo.png, { brandColor: '#C8102E' });
    const meta = await sharp(sq.png).metadata();
    assert.equal(meta.width, 512);
    assert.equal(meta.height, 512);
    assert.equal(sq.background, '#FFFFFF');
    writeFileSync(`${OUT}/square-from-wide-logo.png`, sq.png);

    // White logo made for a dark header → brand-colour backdrop.
    const white = await sharp(Buffer.from(WORDMARK_SVG.replace('#C8102E', '#FFFFFF'))).png().toBuffer();
    const sqWhite = await composeSquareIcon((await analyzeLogo(white))!.png, { brandColor: '#C8102E' });
    assert.equal(sqWhite.background, '#C8102E');
  });

  it('draws monograms as outlines with guaranteed contrast', async () => {
    const m = buildMonogramSvg({ letters: 'BR', background: '#C8102E', fontPath: FONT });
    assert.match(m.svg, /<path d="M/);
    assert.doesNotMatch(m.svg, /<text/);
    assert.equal(m.foreground, '#FFFFFF');
    writeFileSync(`${OUT}/monogram-BR.svg`, m.svg);
    writeFileSync(`${OUT}/monogram-BR.png`, await sharp(Buffer.from(m.svg)).png().toBuffer());

    // Mid-tone green: white letters only reach ~3.3:1 → background is darkened, hue kept.
    const green = buildMonogramSvg({ letters: 'TC', background: '#16A34A', fontPath: FONT });
    assert.equal(green.adjusted, true);
    assert.equal(green.foreground, '#FFFFFF');
    writeFileSync(`${OUT}/monogram-TC-adjusted.png`, await sharp(Buffer.from(green.svg)).png().toBuffer());

    // Bright yellow keeps its colour and gets ink letters instead.
    const yellow = buildMonogramSvg({ letters: 'GA', background: '#FFD500', fontPath: FONT });
    assert.equal(yellow.adjusted, false);
    assert.equal(yellow.foreground, '#0B0B0F');
    writeFileSync(`${OUT}/monogram-GA-yellow.png`, await sharp(Buffer.from(yellow.svg)).png().toBuffer());
  });
});

describe('in-page script', () => {
  it('runs without runtime errors on a realistic DOM (jsdom smoke test)', () => {
    const dom = new JSDOM(
      `<!doctype html><html lang="nl"><head>
        <title>Schoenen online kopen | Brantano</title>
        <meta name="theme-color" content="#c8102e">
        <meta property="og:site_name" content="Brantano">
        <link rel="icon" type="image/svg+xml" href="/favicon.svg">
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
        <style>:root { --color-primary: #c8102e; --primary-foreground: #fff; --brand-hsl: 350 85% 42%; }</style>
        <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization","name":"Brantano","logo":{"@type":"ImageObject","url":"/logo.svg"}}]}</script>
      </head><body>
        <header class="site-header"><a href="/nl/"><img class="logo" alt="Brantano logo" src="/logo.svg"></a></header>
        <main><a href="/x">link</a><button class="btn btn-primary">Shop nu</button></main>
      </body></html>`,
      { url: 'https://www.brantano.be/', runScripts: 'outside-only', pretendToBeVisual: true },
    );
    const result = dom.window.eval(`(${COLLECT_PAGE_SIGNALS})({ maxLogoY: 260, maxCandidates: 6 })`) as PageSignals;
    assert.equal(result.siteName, 'Brantano');
    assert.equal(result.jsonLd.name, 'Brantano');
    assert.equal(result.jsonLd.logo, 'https://www.brantano.be/logo.svg');
    assert.equal(result.headIcons.length, 2);
    assert.ok(result.themeColor);
    // jsdom has no layout engine, so geometry-based parts (logo candidates, buttons) are empty here;
    // those are covered by the Playwright integration test in CI.
  });
});

// ---------------------------------------------------------------------------
// End-to-end with a fake renderer + local asset server (no browser, no API)
// ---------------------------------------------------------------------------

describe('BrandExtractionService (offline end-to-end)', () => {
  let server: Server;
  let base = '';

  before(async () => {
    const assets: Record<string, [string, Buffer]> = {
      '/logo.svg': ['image/svg+xml', Buffer.from(COMBINATION_SVG)],
      '/apple-touch-icon.png': ['image/png', await svgToPng(BADGE_SVG)],
      '/partner.svg': ['image/svg+xml', Buffer.from(WORDMARK_SVG.replace('BRANTANO', 'PARTNER').replace('#C8102E', '#0A66C2'))],
    };
    server = createServer((req, res) => {
      const hit = assets[req.url ?? ''];
      if (!hit) { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'content-type': hit[0] }).end(hit[1]);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(() => server.close());

  it('produces palette, recommendation and icons', async () => {
    const signals: PageSignals = {
      title: 'Schoenen online kopen | Brantano',
      lang: 'nl',
      siteName: null,
      jsonLd: { name: 'Brantano', logo: `${base}/logo.svg` },
      themeColor: 'rgb(200, 16, 46)',
      tileColor: null,
      maskIcon: null,
      headIcons: [{ href: `${base}/apple-touch-icon.png`, rel: 'apple-touch-icon', type: null, sizes: '180x180' }],
      manifestUrl: null,
      ogImage: null,
      cssVars: [{ name: '--color-primary', color: 'rgb(200, 16, 46)' }],
      elements: [
        { role: 'header-bg', color: 'rgb(31, 41, 55)', area: 1440 * 96 },
        { role: 'button-bg', color: 'rgb(200, 16, 46)', area: 220 * 56 * 2 },
        { role: 'link', color: 'rgb(31, 41, 55)', area: 4000 },
      ],
      logoCandidates: [
        { index: 0, kind: 'img', score: 9.5, reasons: ['logo-attr', 'in-header', 'links-home'], src: `${base}/logo.svg`, rect: { x: 80, y: 24, width: 240, height: 48 }, naturalWidth: 600, alt: 'Brantano' },
        { index: 1, kind: 'img', score: 1, reasons: ['top'], src: `${base}/partner.svg`, rect: { x: 1100, y: 24, width: 120, height: 24 }, naturalWidth: 520, alt: null },
      ],
    };

    const fakeRenderer = {
      render: async (url: string): Promise<RenderedPage> => ({
        requestedUrl: url,
        finalUrl: url,
        signals,
        screenshot: await svgToPng(HOMEPAGE_SVG),
        candidateShots: new Map(),
        timingsMs: { total: 1 },
      }),
    } as unknown as PageRenderer;

    const config: BrandExtractionConfig = {
      visionModel: 'claude-sonnet-5',
      monogramFontPath: FONT,
      maxConcurrentRenders: 1,
      totalTimeoutMs: 20_000,
      cacheTtlMs: 60_000,
      allowPrivateNetwork: true, // local fixture server only
    };
    const service = new BrandExtractionService(fakeRenderer, new LogoJudge(config), config);
    const result = await service.extract('http://127.0.0.1/', { companyName: 'Brantano' });

    assert.equal(result.palette.primary, '#C8102E');
    assert.equal(result.palette.accent, '#1F2937');
    assert.equal(result.icon.monogram.letters, 'BR');
    assert.equal(result.diagnostics.decidedBy, 'heuristic'); // no API key in tests
    assert.equal(result.icon.recommendation, 'logo'); // the square apple-touch-icon qualifies
    assert.ok(result.icon.logoSquarePng?.startsWith('data:image/png;base64,'));
    assert.ok(result.diagnostics.candidates.some((c) => c.origin === 'symbol-crop'));

    const dump = (dataUrl: string | null, name: string) =>
      dataUrl && writeFileSync(`${OUT}/${name}`, Buffer.from(dataUrl.split(',')[1], 'base64'));
    dump(result.icon.logoSquarePng, 'e2e-logo-square.png');
    dump(result.icon.logoPng, 'e2e-logo.png');
    writeFileSync(`${OUT}/e2e-result.json`, JSON.stringify({ ...result, icon: { ...result.icon, logoPng: '…', logoSquarePng: '…', monogram: { ...result.icon.monogram, svg: '…' } } }, null, 2));
  });
});
