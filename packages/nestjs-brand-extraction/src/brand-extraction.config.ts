export interface BrandExtractionOptions {
  /** Anthropic key for the logo vision check. Without it the heuristic fallback is used. */
  anthropicApiKey?: string;
  /** Vision model. Default `claude-sonnet-5`; `claude-haiku-4-5-20251001` is cheaper and usually fine. */
  visionModel?: string;
  /** .ttf/.otf used to draw monogram letters as outlines (the product's brand font). */
  monogramFontPath?: string;
  /** Chromium executable; leave empty when using the Playwright Docker image. */
  chromiumExecutablePath?: string;
  /** Parallel renders. Each Chromium context costs ~150–300 MB. Default 2. */
  maxConcurrentRenders?: number;
  /** Hard cap for one extraction, end to end. Default 45 s. */
  totalTimeoutMs?: number;
  /** In-process result cache. Default 24 h. */
  cacheTtlMs?: number;
  /** Only for local tests against a fixture server. Never enable in production. */
  allowPrivateNetwork?: boolean;
}

export interface BrandExtractionConfig {
  anthropicApiKey?: string;
  visionModel: string;
  monogramFontPath?: string;
  chromiumExecutablePath?: string;
  maxConcurrentRenders: number;
  totalTimeoutMs: number;
  cacheTtlMs: number;
  allowPrivateNetwork: boolean;
}

export const BRAND_EXTRACTION_CONFIG = Symbol('BRAND_EXTRACTION_CONFIG');

export function resolveBrandExtractionConfig(o: BrandExtractionOptions = {}): BrandExtractionConfig {
  return {
    anthropicApiKey: o.anthropicApiKey || undefined,
    visionModel: o.visionModel || 'claude-sonnet-5',
    monogramFontPath: o.monogramFontPath || undefined,
    chromiumExecutablePath: o.chromiumExecutablePath || undefined,
    maxConcurrentRenders: o.maxConcurrentRenders ?? 2,
    totalTimeoutMs: o.totalTimeoutMs ?? 45_000,
    cacheTtlMs: o.cacheTtlMs ?? 24 * 60 * 60 * 1000,
    allowPrivateNetwork: o.allowPrivateNetwork ?? false,
  };
}
