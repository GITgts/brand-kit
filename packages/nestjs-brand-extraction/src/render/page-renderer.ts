import { Inject, Injectable, Logger } from '@nestjs/common';
import type { BrowserContext, Page, Route } from 'playwright-core';
import { BRAND_EXTRACTION_CONFIG, BrandExtractionConfig } from '../brand-extraction.config';
import { PageSignals, RenderedPage } from '../brand-extraction.types';
import { assertPublicHost } from '../net/address-guard';
import { BROWSER_UA } from '../net/safe-fetch';
import { BrowserProvider } from './browser.provider';
import { COLLECT_PAGE_SIGNALS, HIDE_OVERLAYS_CSS, HIDE_OVERLAYS_SCRIPT } from './collect-page-signals.script';

const VIEWPORT = { width: 1440, height: 900 };
const MAX_LOGO_CANDIDATES = 6;

/** Third parties that only cost time (and often inject consent layers). */
const BLOCKED_HOSTS =
  /(googletagmanager|google-analytics|googleadservices|doubleclick|facebook\.net|connect\.facebook|hotjar|clarity\.ms|segment\.(io|com)|hs-analytics|hs-scripts|leadinfo|linkedin\.com\/px|snap\.licdn|tiktok|pinterest|bing\.com\/bat|cookiebot|onetrust|cookielaw|usercentrics|didomi|intercom|crisp\.chat|tawk\.to|zopim|zendesk|youtube\.com\/embed|vimeo)/i;

@Injectable()
export class PageRenderer {
  private readonly logger = new Logger(PageRenderer.name);

  constructor(
    @Inject(BrowserProvider) private readonly browsers: BrowserProvider,
    @Inject(BRAND_EXTRACTION_CONFIG) private readonly config: BrandExtractionConfig,
  ) {}

  async render(url: string): Promise<RenderedPage> {
    const t0 = Date.now();
    const timings: Record<string, number> = {};
    const browser = await this.browsers.get();
    timings.browser = Date.now() - t0;

    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 2, // crisp element screenshots of logos
      locale: 'nl-BE',
      timezoneId: 'Europe/Brussels',
      userAgent: BROWSER_UA,
      colorScheme: 'light',
      serviceWorkers: 'block',
      acceptDownloads: false,
      ignoreHTTPSErrors: false,
    });

    try {
      await this.installNetworkGuard(context);
      const page = await context.newPage();
      page.setDefaultTimeout(10_000);

      const finalUrl = await this.navigate(page, url);
      // Playwright's route handler does not see redirect hops, so re-validate
      // where we ended up before anything from the page is captured.
      await assertPublicHost(new URL(finalUrl).hostname, this.config.allowPrivateNetwork);
      timings.navigate = Date.now() - t0 - timings.browser;

      // Let lazy headers, web fonts and client-side frameworks settle.
      await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);

      // A bot-protection interstitial would otherwise yield a confident but wrong palette.
      const title = await page.title().catch(() => '');
      if (/just a moment|attention required|access denied|checking your browser|verify you are human|ddos-guard/i.test(title)) {
        throw new Error(`bot-protection page ("${title}")`);
      }
      await page.addStyleTag({ content: HIDE_OVERLAYS_CSS }).catch(() => undefined);
      await page.evaluate(`(${HIDE_OVERLAYS_SCRIPT})()`).catch(() => 0);
      await page.evaluate('window.scrollTo(0, 0)');
      await page.waitForTimeout(400);

      const tSignals = Date.now();
      const signals = (await page.evaluate(
        `(${COLLECT_PAGE_SIGNALS})(${JSON.stringify({ maxLogoY: 260, maxCandidates: MAX_LOGO_CANDIDATES })})`,
      )) as PageSignals;
      timings.signals = Date.now() - tSignals;

      const tShots = Date.now();
      const screenshot = await page.screenshot({ type: 'png', fullPage: false, animations: 'disabled' });
      const candidateShots = new Map<number, Buffer>();
      for (const cand of signals.logoCandidates) {
        try {
          const shot = await page
            .locator(`[data-bx-cand="${cand.index}"]`)
            .first()
            .screenshot({ type: 'png', omitBackground: true, animations: 'disabled', timeout: 3_000 });
          candidateShots.set(cand.index, shot);
        } catch (err) {
          this.logger.debug(`Candidate ${cand.index} screenshot failed: ${(err as Error).message}`);
        }
      }
      timings.screenshots = Date.now() - tShots;
      timings.total = Date.now() - t0;

      return { requestedUrl: url, finalUrl, signals, screenshot, candidateShots, timingsMs: timings };
    } finally {
      await context.close().catch(() => undefined);
    }
  }

  private async navigate(page: Page, url: string): Promise<string> {
    const attempt = async (u: string) => {
      const res = await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 20_000 });
      if (res && res.status() >= 400 && res.status() !== 403) {
        // 403 is common for bot protection that still renders a usable page; others are fatal.
        throw new Error(`HTTP ${res.status()} for ${u}`);
      }
      return page.url();
    };
    try {
      return await attempt(url);
    } catch (err) {
      if (url.startsWith('https://') && /ERR_(SSL|CERT|CONNECTION_REFUSED|NAME)/.test((err as Error).message)) {
        return attempt(url.replace('https://', 'http://'));
      }
      throw err;
    }
  }

  /**
   * Validates every request the page makes against the SSRF guard and drops
   * media/trackers. Redirect hops bypass `route`, which is why `render()` also
   * re-checks the final URL before capturing anything.
   *
   * Chromium resolves DNS itself, so a determined attacker could still race a
   * DNS rebind between our check and Chromium's connect. Defence in depth: run
   * the renderer in a container/network namespace without access to internal
   * ranges (see AGENTS.md → "Deployment").
   */
  private async installNetworkGuard(context: BrowserContext): Promise<void> {
    const hostChecks = new Map<string, Promise<boolean>>();
    const isAllowed = (host: string) => {
      let p = hostChecks.get(host);
      if (!p) {
        p = assertPublicHost(host, this.config.allowPrivateNetwork).then(
          () => true,
          () => false,
        );
        hostChecks.set(host, p);
      }
      return p;
    };

    await context.route('**/*', async (route: Route) => {
      const req = route.request();
      const type = req.resourceType();
      let u: URL;
      try {
        u = new URL(req.url());
      } catch {
        return route.abort();
      }
      if (u.protocol === 'data:' || u.protocol === 'blob:') return route.continue();
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return route.abort();
      if (type === 'media' || type === 'websocket' || type === 'eventsource' || type === 'manifest') return route.abort();
      if (BLOCKED_HOSTS.test(u.hostname + u.pathname)) return route.abort();
      if (!(await isAllowed(u.hostname))) return route.abort('blockedbyclient');
      return route.continue();
    });
  }
}
