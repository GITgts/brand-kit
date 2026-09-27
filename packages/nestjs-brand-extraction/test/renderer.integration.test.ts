/**
 * Real Chromium against a local fixture site. Skipped unless RUN_BROWSER_TESTS=1
 * (needs `npx playwright install chromium` or the Playwright Docker image).
 *
 *   RUN_BROWSER_TESTS=1 npx tsx --test test/renderer.integration.test.ts
 */
import assert from 'node:assert/strict';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { BrandExtractionConfig } from '../src/brand-extraction.config';
import { BrowserProvider } from '../src/render/browser.provider';
import { PageRenderer } from '../src/render/page-renderer';

const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="48"><circle cx="24" cy="24" r="22" fill="#C8102E"/><text x="56" y="34" font-size="28" font-family="Arial" font-weight="700" fill="#1F2937">BRANTANO</text></svg>`;

const PAGE = `<!doctype html><html lang="nl"><head><title>Schoenen | Brantano</title>
<meta name="theme-color" content="#c8102e">
<style>
  :root { --color-primary: 350 85% 42%; --brand: #c8102e; }
  body { margin: 0; font-family: Arial; }
  header { background: #1F2937; height: 96px; display: flex; align-items: center; padding: 0 80px; justify-content: space-between; }
  .btn { background: hsl(var(--color-primary)); color: #fff; padding: 16px 32px; border: 0; border-radius: 8px; }
  main a { color: #1F2937; }
  #cookie { position: fixed; bottom: 0; left: 0; right: 0; height: 240px; background: #0A66C2; color: #fff; z-index: 9999; }
</style></head><body>
<header><a href="/nl/" class="logo-link"><img class="site-logo" alt="Brantano" src="/logo.svg" width="240" height="48"></a>
  <img alt="Visa" class="payment-icon" src="/logo.svg" width="60" height="12"></header>
<main style="padding: 80px"><h1>Nieuwe collectie</h1><button class="btn">Shop nu</button> <a href="/x">Meer info</a></main>
<div id="cookie">Wij gebruiken cookies. <button>Alle cookies accepteren</button></div>
</body></html>`;

const enabled = process.env.RUN_BROWSER_TESTS === '1';

describe('PageRenderer (Chromium)', { skip: !enabled }, () => {
  let server: Server;
  let base = '';
  let browsers: BrowserProvider;

  before(async () => {
    server = createServer((req, res) => {
      if (req.url === '/logo.svg') return void res.writeHead(200, { 'content-type': 'image/svg+xml' }).end(LOGO);
      res.writeHead(200, { 'content-type': 'text/html' }).end(PAGE);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  });
  after(async () => {
    await browsers?.onModuleDestroy();
    server.close();
  });

  it('collects signals, hides the consent layer and screenshots the logo', async () => {
    const config = { allowPrivateNetwork: true, maxConcurrentRenders: 1 } as BrandExtractionConfig;
    browsers = new BrowserProvider(config);
    const page = await new PageRenderer(browsers, config).render(base);

    const s = page.signals;
    assert.equal(s.themeColor, 'rgb(200, 16, 46)');
    assert.ok(s.cssVars.some((v) => v.name === '--color-primary')); // bare HSL triplet resolved
    assert.ok(s.elements.some((e) => e.role === 'button-bg'));
    assert.ok(s.elements.some((e) => e.role === 'header-bg' && e.color === 'rgb(31, 41, 55)'));
    assert.equal(s.logoCandidates[0].alt, 'Brantano'); // the payment icon ranks below
    assert.ok(page.candidateShots.has(0));

    // The blue cookie bar must not be in the screenshot.
    const sharp = (await import('sharp')).default;
    const { data } = await sharp(page.screenshot).extract({ left: 1400, top: 1700, width: 40, height: 40 }).raw().toBuffer({ resolveWithObject: true });
    assert.notEqual(`${data[0]},${data[1]},${data[2]}`, '10,102,194');
  });
});
