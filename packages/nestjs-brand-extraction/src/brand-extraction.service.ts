import { Inject, Injectable, Logger } from '@nestjs/common';
import { flatten, parseCssColor } from '@wisemen/brand-kit';
import { extractImagePalette } from './color/image-palette';
import { ColorEvidence, EvidenceSource, scorePalette } from './color/palette-scorer';
import { BRAND_EXTRACTION_CONFIG, BrandExtractionConfig } from './brand-extraction.config';
import {
  BrandExtractionResult,
  ExtractOptions,
  LogoCandidate,
  LogoOrigin,
  PageSignals,
  RenderedPage,
} from './brand-extraction.types';
import { buildMonogramSvg, deriveMonogramLetters } from './icon/monogram';
import { composeSquareIcon } from './icon/square-icon';
import { analyzeLogo, dHash, findSymbolCrops, hamming, isMonochromeDark, rasterize } from './logo/logo-analysis';
import { LogoJudge } from './logo/logo-judge';
import { assertPublicHost } from './net/address-guard';
import { safeFetch } from './net/safe-fetch';
import { PageRenderer } from './render/page-renderer';
import { InFlight, Semaphore, withTimeout } from './util/concurrency';
import { TtlCache } from './util/ttl-cache';

/** Port so the wizard doesn't care whether this runs in-house or via a vendor. */
export interface BrandExtractor {
  extract(url: string, opts?: ExtractOptions): Promise<BrandExtractionResult>;
}
export const BRAND_EXTRACTOR = Symbol('BRAND_EXTRACTOR');

export class InvalidWebsiteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidWebsiteError';
  }
}

/** WiseOS indigo, used when a site yields no usable brand colour. */
const FALLBACK_PRIMARY = '#4F46E5';
const MAX_JUDGED_ORIGINALS = 4;
const MAX_SYMBOL_CROPS = 2;

const ORIGIN_PRIOR: Record<LogoOrigin, number> = {
  'json-ld': 6,
  'header-element': 0, // uses the DOM score instead
  'svg-favicon': 3.5,
  'apple-touch-icon': 3,
  'manifest-icon': 3,
  favicon: 1,
  'og-image': -2,
  'symbol-crop': 0,
};

@Injectable()
export class BrandExtractionService implements BrandExtractor {
  private readonly logger = new Logger(BrandExtractionService.name);
  private readonly cache: TtlCache<BrandExtractionResult>;
  private readonly inFlight = new InFlight<BrandExtractionResult>();
  private readonly renders: Semaphore;

  constructor(
    // Explicit tokens: works without emitDecoratorMetadata (esbuild/SWC/tsx).
    @Inject(PageRenderer) private readonly renderer: PageRenderer,
    @Inject(LogoJudge) private readonly judge: LogoJudge,
    @Inject(BRAND_EXTRACTION_CONFIG) private readonly config: BrandExtractionConfig,
  ) {
    this.cache = new TtlCache(config.cacheTtlMs);
    this.renders = new Semaphore(config.maxConcurrentRenders);
  }

  async extract(rawUrl: string, opts: ExtractOptions = {}): Promise<BrandExtractionResult> {
    const url = normalizeWebsite(rawUrl);
    const domain = new URL(url).hostname.replace(/^www\./, '');
    await assertPublicHost(new URL(url).hostname, this.config.allowPrivateNetwork).catch(() => {
      throw new InvalidWebsiteError(`"${rawUrl}" is geen publiek bereikbare website.`);
    });

    const key = `${domain}|${opts.companyName ?? ''}`;
    if (!opts.force) {
      const cached = this.cache.get(key);
      if (cached) return cached;
    }

    return this.inFlight.run(key, async () => {
      const result = await withTimeout(this.run(url, domain, opts), this.config.totalTimeoutMs, 'Brand extraction');
      this.cache.set(key, result);
      return result;
    });
  }

  // -------------------------------------------------------------------------

  private async run(url: string, domain: string, opts: ExtractOptions): Promise<BrandExtractionResult> {
    const t0 = Date.now();
    const warnings: string[] = [];
    const timings: Record<string, number> = {};

    let page: RenderedPage | null = null;
    try {
      page = await this.renders.run(() => this.renderer.render(url));
      Object.assign(timings, prefix('render.', page.timingsMs));
    } catch (err) {
      warnings.push(`render-failed: ${(err as Error).message}`);
      this.logger.warn(`Render failed for ${url}: ${(err as Error).message}`);
    }

    const finalUrl = page?.finalUrl ?? url;
    const signals = page?.signals ?? null;
    const companyName = opts.companyName?.trim() || guessCompanyName(signals, domain);

    // 1. Logo candidates
    const tLogo = Date.now();
    const candidates = page
      ? await this.collectLogoCandidates(page, warnings)
      : await this.collectFallbackCandidates(finalUrl, warnings);
    timings.logos = Date.now() - tLogo;

    // 2. Vision check
    const tJudge = Date.now();
    const assessment = await this.judge.assess(candidates, { companyName, domain });
    timings.judge = Date.now() - tJudge;
    const byId = new Map(candidates.map((c) => [c.id, c]));
    const bestLogo = assessment.bestLogoId ? byId.get(assessment.bestLogoId) ?? null : null;
    const bestSquare = assessment.bestSquareId ? byId.get(assessment.bestSquareId) ?? null : null;

    // 3. Colours (logo colours come from the logo the judge picked)
    const tColor = Date.now();
    const evidence = [
      ...(signals ? evidenceFromSignals(signals) : []),
      ...(page ? await evidenceFromImage(page.screenshot, 'screenshot', null) : []),
      ...(bestLogo ?? bestSquare ? await evidenceFromImage((bestLogo ?? bestSquare)!.png, 'logo', (bestLogo ?? bestSquare)!.backgroundHex) : []),
    ];
    const palette = scorePalette(evidence);
    timings.colors = Date.now() - tColor;
    if (!palette.primary) warnings.push('no-brand-color');

    // 4. Icons
    const primaryHex = palette.primary?.hex ?? FALLBACK_PRIMARY;
    const letters = deriveMonogramLetters(companyName);
    const monogram = buildMonogramSvg({ letters, background: primaryHex, fontPath: this.config.monogramFontPath });

    const squareSource = bestSquare ?? bestLogo;
    const square = squareSource
      ? await composeSquareIcon(squareSource.png, {
          logoBackground: squareSource.backgroundHex,
          brandColor: primaryHex,
          isTile: squareSource.isTile,
        })
      : null;

    timings.total = Date.now() - t0;

    return {
      domain,
      finalUrl,
      companyName,
      analyzedAt: new Date().toISOString(),
      palette: {
        primary: palette.primary?.hex ?? null,
        accent: palette.accent?.hex ?? null,
        swatches: palette.swatches.map((s) => ({ hex: s.hex, explanation: s.explanation })),
        primarySurface: palette.primarySurface,
      },
      icon: {
        recommendation: assessment.recommendation,
        reason: assessment.reason,
        monogram: { letters, svg: monogram.svg, background: monogram.background, foreground: monogram.foreground },
        logoSquarePng: square ? toDataUrl(square.png) : null,
        logoPng: bestLogo ? toDataUrl(bestLogo.png) : null,
        logoSourceUrl: bestLogo?.sourceUrl ?? null,
      },
      diagnostics: {
        decidedBy: assessment.decidedBy,
        candidates: candidates.map(({ id, origin, sourceUrl, aspect, priorScore, notes }) => ({
          id, origin, sourceUrl, aspect: round(aspect), priorScore: round(priorScore), notes,
        })),
        assessment: assessment.perCandidate,
        colorClusters: palette.clusters.slice(0, 12).map((c) => ({ hex: c.hex, score: c.score, sources: c.sources })),
        warnings,
        timingsMs: timings,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Logo candidates
  // -------------------------------------------------------------------------

  private async collectLogoCandidates(page: RenderedPage, warnings: string[]): Promise<LogoCandidate[]> {
    const { signals } = page;
    const raw: Omit<LogoCandidate, 'id'>[] = [];

    // a) Elements in the page header, ranked by DOM heuristics.
    await Promise.all(
      signals.logoCandidates.map(async (c, rank) => {
        const shot = page.candidateShots.get(c.index) ?? null;
        const original = c.src ? await this.fetchRaster(c.src) : null;
        const png = await pickBetterRender(original, shot, c.rect.width);
        if (!png) return;
        const added = await this.toCandidate(png, 'header-element', c.src, c.score + (rank === 0 ? 1 : 0), [
          `dom:${c.reasons.join(',')}`,
          png === original ? 'from-source' : 'from-render',
        ]);
        if (added) raw.push(added);
      }),
    );

    // b) Declared assets.
    const declared: { url: string; origin: LogoOrigin }[] = [];
    if (signals.jsonLd.logo) declared.push({ url: signals.jsonLd.logo, origin: 'json-ld' });
    const svgIcon = signals.headIcons.find((i) => i.type?.includes('svg') || /\.svg(\?|$)/i.test(i.href));
    if (svgIcon) declared.push({ url: svgIcon.href, origin: 'svg-favicon' });
    const touch = largestIcon(signals.headIcons.filter((i) => i.rel.includes('apple-touch-icon')));
    if (touch) declared.push({ url: touch.href, origin: 'apple-touch-icon' });
    const favicon = largestIcon(signals.headIcons.filter((i) => !i.rel.includes('apple') && i !== svgIcon));
    if (favicon) declared.push({ url: favicon.href, origin: 'favicon' });
    if (signals.manifestUrl) {
      const icon = await this.manifestIcon(signals.manifestUrl);
      if (icon) declared.push({ url: icon, origin: 'manifest-icon' });
    }
    if (signals.ogImage) declared.push({ url: signals.ogImage, origin: 'og-image' });

    await Promise.all(
      declared.map(async ({ url, origin }) => {
        const png = await this.fetchRaster(url);
        if (!png) return;
        const added = await this.toCandidate(png, origin, url, ORIGIN_PRIOR[origin], []);
        if (added) raw.push(added);
      }),
    );

    if (raw.length === 0) warnings.push('no-logo-candidates');
    return this.finalizeCandidates(raw);
  }

  /** When Chromium couldn't render the site: conventional icon locations only. */
  private async collectFallbackCandidates(siteUrl: string, warnings: string[]): Promise<LogoCandidate[]> {
    const origin = new URL(siteUrl).origin;
    const guesses: { url: string; origin: LogoOrigin }[] = [
      { url: `${origin}/apple-touch-icon.png`, origin: 'apple-touch-icon' },
      { url: `${origin}/favicon.svg`, origin: 'svg-favicon' },
      { url: `${origin}/favicon.ico`, origin: 'favicon' },
    ];
    const raw: Omit<LogoCandidate, 'id'>[] = [];
    await Promise.all(
      guesses.map(async (g) => {
        const png = await this.fetchRaster(g.url);
        const added = png && (await this.toCandidate(png, g.origin, g.url, ORIGIN_PRIOR[g.origin], ['fallback']));
        if (added) raw.push(added);
      }),
    );
    warnings.push('fallback-without-browser');
    return this.finalizeCandidates(raw);
  }

  private async toCandidate(
    png: Buffer,
    origin: LogoOrigin,
    sourceUrl: string | null,
    priorScore: number,
    notes: string[],
  ): Promise<Omit<LogoCandidate, 'id'> | null> {
    const a = await analyzeLogo(png).catch(() => null);
    if (!a || Math.min(a.width, a.height) < 16) return null;
    // Tiny favicons are noise next to real logos.
    if (origin === 'favicon' && Math.max(a.width, a.height) < 64) return null;
    return {
      origin,
      sourceUrl,
      png: a.png,
      width: a.width,
      height: a.height,
      aspect: a.aspect,
      hasTransparency: a.hasTransparency,
      backgroundHex: a.backgroundHex,
      isLightOnTransparent: a.isLightOnTransparent,
      isTile: a.isTile,
      priorScore,
      notes,
    };
  }

  /**
   * Dedupe (the same logo usually appears as header <img>, JSON-LD and favicon),
   * reward cross-source agreement, keep the best few, add symbol crops.
   */
  private async finalizeCandidates(raw: Omit<LogoCandidate, 'id'>[]): Promise<LogoCandidate[]> {
    const sorted = raw.sort((a, b) => b.priorScore - a.priorScore || b.width * b.height - a.width * a.height);
    const kept: (Omit<LogoCandidate, 'id'> & { hash: bigint })[] = [];
    for (const c of sorted) {
      const hash = await dHash(c.png);
      const dup = kept.find((k) => hamming(k.hash, hash) <= 6 && Math.abs(Math.log(k.aspect / c.aspect)) < 0.15);
      if (dup) {
        dup.priorScore += 1.5;
        dup.notes.push(`also:${c.origin}`);
        // Keep the sharper version of the same logo.
        if (c.width * c.height > dup.width * dup.height * 1.5) Object.assign(dup, { ...c, priorScore: dup.priorScore, notes: dup.notes, hash });
        continue;
      }
      kept.push({ ...c, hash });
    }

    const originals = kept
      .sort((a, b) => b.priorScore - a.priorScore)
      .slice(0, MAX_JUDGED_ORIGINALS)
      .map(({ hash, ...c }, i) => ({ ...c, id: `c${i}` }));

    const crops: LogoCandidate[] = [];
    for (const parent of originals) {
      if (crops.length >= MAX_SYMBOL_CROPS) break;
      if (parent.origin === 'og-image' || parent.isTile) continue;
      const found = await findSymbolCrops({
        png: parent.png, width: parent.width, height: parent.height, aspect: parent.aspect,
        hasTransparency: parent.hasTransparency, backgroundHex: parent.backgroundHex,
        isLightOnTransparent: parent.isLightOnTransparent, isTile: parent.isTile,
      }).catch(() => []);
      for (const crop of found.slice(0, MAX_SYMBOL_CROPS - crops.length)) {
        const c = await this.toCandidate(crop.png, 'symbol-crop', parent.sourceUrl, parent.priorScore - 1, [crop.layout]);
        if (c) crops.push({ ...c, id: `c${originals.length + crops.length}`, derivedFrom: parent.id, backgroundHex: parent.backgroundHex, isTile: false });
      }
    }
    return [...originals, ...crops];
  }

  private async fetchRaster(url: string): Promise<Buffer | null> {
    try {
      const res = await safeFetch(url, {
        accept: 'image/avif,image/webp,image/svg+xml,image/*,*/*;q=0.8',
        maxBytes: 4 * 1024 * 1024,
        allowPrivateNetwork: this.config.allowPrivateNetwork,
      });
      if (res.status >= 400) return null;
      if (res.contentType.startsWith('text/html')) return null;
      return await rasterize(res.body, res.contentType, res.url);
    } catch {
      return null;
    }
  }

  private async manifestIcon(manifestUrl: string): Promise<string | null> {
    try {
      const res = await safeFetch(manifestUrl, { maxBytes: 256 * 1024, allowPrivateNetwork: this.config.allowPrivateNetwork });
      const json = JSON.parse(res.body.toString('utf8')) as { icons?: { src: string; sizes?: string; purpose?: string }[] };
      const icons = (json.icons ?? []).filter((i) => i.src && !/monochrome/.test(i.purpose ?? ''));
      // Prefer "any" over "maskable" (maskable icons carry extra safe-zone padding).
      icons.sort((a, b) => {
        const m = (i: typeof a) => (/maskable/.test(i.purpose ?? '') && !/any/.test(i.purpose ?? '') ? 1 : 0);
        return m(a) - m(b) || sizeOf(b.sizes) - sizeOf(a.sizes);
      });
      return icons[0] ? new URL(icons[0].src, res.url).href : null;
    } catch {
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function normalizeWebsite(input: string): string {
  let s = input.trim();
  if (!s) throw new InvalidWebsiteError('Geen website opgegeven.');
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    throw new InvalidWebsiteError(`"${input}" is geen geldige website.`);
  }
  if (!u.hostname.includes('.') && u.hostname !== 'localhost') throw new InvalidWebsiteError(`"${input}" is geen geldige website.`);
  // Brand identity lives on the homepage; ignore deep links and tracking params.
  return `${u.protocol}//${u.hostname.toLowerCase()}${u.port ? `:${u.port}` : ''}/`;
}

function guessCompanyName(signals: PageSignals | null, domain: string): string {
  const label = domain.split('.').slice(-2, -1)[0] ?? domain;
  const candidates = [signals?.jsonLd.name, signals?.siteName].filter((s): s is string => !!s && s.length <= 60);
  if (candidates[0]) return candidates[0].trim();
  if (signals?.title) {
    const parts = signals.title.split(/\s+[|–—·•:-]\s+/).map((p) => p.trim()).filter(Boolean);
    const matching = parts.find((p) => p.toLowerCase().replace(/[^a-z0-9]/g, '').includes(label.replace(/[^a-z0-9]/g, '')));
    if (matching && matching.length <= 60) return matching;
  }
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function evidenceFromSignals(s: PageSignals): ColorEvidence[] {
  const out: ColorEvidence[] = [];
  const add = (value: string | null | undefined, source: EvidenceSource, strength: number, detail?: string) => {
    const c = parseCssColor(value);
    if (!c || c.a < 0.5) return;
    out.push({ rgb: flatten(c), source, strength, detail });
  };

  add(s.themeColor, 'theme-color', 1);
  add(s.tileColor, 'tile-color', 1);
  add(s.maskIcon?.color, 'mask-icon', 1);
  for (const v of s.cssVars) add(v.color, 'css-var-brand', /primary|brand|huisstijl|corporate/i.test(v.name) ? 1 : 0.5, v.name);

  // Per role: strength = share of that colour's area within the role.
  const byRole = new Map<string, Map<string, number>>();
  for (const e of s.elements) {
    const role = byRole.get(e.role) ?? new Map<string, number>();
    role.set(e.color, (role.get(e.color) ?? 0) + e.area);
    byRole.set(e.role, role);
  }
  for (const [role, colors] of byRole) {
    const total = [...colors.values()].reduce((a, b) => a + b, 0) || 1;
    for (const [color, area] of colors) add(color, role as EvidenceSource, area / total);
  }
  return out;
}

async function evidenceFromImage(png: Buffer, source: 'screenshot' | 'logo', backgroundHex: string | null): Promise<ColorEvidence[]> {
  const palette = await extractImagePalette(png, { maxSide: source === 'logo' ? 96 : 160, k: source === 'logo' ? 5 : 10 }).catch(() => []);
  const bg = backgroundHex ? parseCssColor(backgroundHex) : null;
  return palette
    .map((p) => {
      // A logo's backdrop tile counts only half: it's brand-ish but also often just a container.
      const isBg = bg && Math.abs(p.rgb.r - bg.r) + Math.abs(p.rgb.g - bg.g) + Math.abs(p.rgb.b - bg.b) < 30;
      const strength = source === 'screenshot' ? Math.min(1, p.share * 3) : Math.min(1, p.share * 1.5) * (isBg ? 0.5 : 1);
      return { rgb: p.rgb, source, strength };
    })
    .filter((e) => e.strength > 0.01);
}

/**
 * Prefers the original asset (vector / higher resolution), unless it is a
 * `currentColor` SVG that renders black outside the page while the in-page
 * render shows the real colours.
 */
async function pickBetterRender(original: Buffer | null, shot: Buffer | null, cssWidth: number): Promise<Buffer | null> {
  if (!original) return shot;
  if (!shot) return original;
  if ((await isMonochromeDark(original)) && !(await isMonochromeDark(shot))) return shot;
  const { default: sharp } = await import('sharp');
  const ow = (await sharp(original).metadata()).width ?? 0;
  // The element screenshot is at device scale 2.
  return ow >= cssWidth * 1.5 ? original : shot;
}

function largestIcon<T extends { sizes: string | null }>(icons: T[]): T | null {
  return icons.sort((a, b) => sizeOf(b.sizes) - sizeOf(a.sizes))[0] ?? null;
}

function sizeOf(sizes?: string | null): number {
  if (!sizes) return 0;
  if (sizes === 'any') return 10_000;
  return Math.max(0, ...sizes.split(/\s+/).map((s) => parseInt(s, 10) || 0));
}

const toDataUrl = (png: Buffer) => `data:image/png;base64,${png.toString('base64')}`;
const round = (n: number) => Math.round(n * 100) / 100;
const prefix = (p: string, o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [p + k, v]));
