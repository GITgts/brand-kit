/**
 * The public contract of the brand service. Every consumer (brand-service,
 * app backends that proxy it, Vue/React UIs) imports these types from here.
 * Changing a field here is a breaking change: bump the major version.
 */

export type IconRecommendation = 'monogram' | 'logo';

export type LogoOrigin =
  | 'header-element'
  | 'json-ld'
  | 'apple-touch-icon'
  | 'svg-favicon'
  | 'manifest-icon'
  | 'favicon'
  | 'og-image'
  | 'symbol-crop';

export interface LogoAssessmentEntry {
  id: string;
  isCompanyLogo: boolean;
  kind: 'symbol' | 'wordmark' | 'combination' | 'emblem' | 'not_a_logo';
  legibleInSquare48: boolean;
  quality: 'good' | 'acceptable' | 'poor';
  issues: string[];
}

export interface PrimarySurface {
  /** Primary colour, darkened if needed so `onColor` text passes WCAG AA. */
  hex: string;
  onColor: string;
  adjusted: boolean;
  contrast: number;
}

/**
 * Known values of `diagnostics.warnings`. Unknown values may be added in minor
 * versions; consumers must ignore warnings they don't recognise.
 */
export type BrandWarning =
  | 'no-brand-color'
  | 'no-logo-candidates'
  | 'fallback-without-browser'
  | `render-failed: ${string}`;

export interface BrandExtractionResult {
  domain: string;
  finalUrl: string;
  companyName: string;
  /** ISO timestamp. */
  analyzedAt: string;

  palette: {
    primary: string | null;
    accent: string | null;
    /** 0–6 swatches for a picker, primary first. `explanation` is Dutch UI copy. */
    swatches: { hex: string; explanation: string }[];
    primarySurface: PrimarySurface | null;
  };

  icon: {
    recommendation: IconRecommendation;
    /** One Dutch sentence explaining the recommendation to the user. */
    reason: string;
    monogram: { letters: string; svg: string; background: string; foreground: string };
    /** 512×512 PNG data URL built from the best square-able logo. */
    logoSquarePng: string | null;
    /** Trimmed original logo as PNG data URL. */
    logoPng: string | null;
    logoSourceUrl: string | null;
  };

  diagnostics: {
    decidedBy: 'vision' | 'heuristic';
    candidates: { id: string; origin: LogoOrigin; sourceUrl: string | null; aspect: number; priorScore: number; notes: string[] }[];
    assessment: LogoAssessmentEntry[];
    colorClusters: { hex: string; score: number; sources: string[] }[];
    warnings: (BrandWarning | string)[];
    timingsMs: Record<string, number>;
  };
}

export interface ExtractOptions {
  /** Bypass the cache ("Opnieuw analyseren"). */
  force?: boolean;
  /** Name the user typed; beats anything scraped. */
  companyName?: string;
}

/** POST /v1/brand/extract */
export interface ExtractRequest extends ExtractOptions {
  website: string;
}

/** POST /v1/brand/monogram */
export interface MonogramRequest {
  /** 1–3 letters or digits. */
  letters: string;
  /** #RRGGBB */
  background: string;
}

export interface MonogramResponse {
  svg: string;
  background: string;
  foreground: string;
  adjusted: boolean;
}

export type BrandErrorKind = 'invalid-website' | 'invalid-request' | 'timeout' | 'unauthorized' | 'rate-limited' | 'network' | 'server';
