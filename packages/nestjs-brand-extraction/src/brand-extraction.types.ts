
// ---------------------------------------------------------------------------
// What the in-page script returns
// ---------------------------------------------------------------------------

export interface PageSignals {
  title: string | null;
  lang: string | null;
  siteName: string | null;
  jsonLd: { name: string | null; logo: string | null };
  themeColor: string | null;
  tileColor: string | null;
  maskIcon: { href: string; color: string | null } | null;
  headIcons: { href: string; rel: string; type: string | null; sizes: string | null }[];
  manifestUrl: string | null;
  ogImage: string | null;
  cssVars: { name: string; color: string }[];
  elements: { role: 'header-bg' | 'button-bg' | 'button-outline' | 'link'; color: string; area: number }[];
  logoCandidates: {
    index: number;
    kind: 'img' | 'svg' | 'bg';
    score: number;
    reasons: string[];
    src: string | null;
    rect: { x: number; y: number; width: number; height: number };
    naturalWidth: number | null;
    alt: string | null;
  }[];
}

export interface RenderedPage {
  requestedUrl: string;
  finalUrl: string;
  signals: PageSignals;
  /** Above-the-fold screenshot (PNG, device scale 2). */
  screenshot: Buffer;
  /** Element screenshots keyed by candidate index (PNG, transparent where the page allows). */
  candidateShots: Map<number, Buffer>;
  timingsMs: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Logo candidates after download + analysis
// ---------------------------------------------------------------------------

export type { LogoOrigin } from '@wisemen/brand-kit';
import type { LogoOrigin } from '@wisemen/brand-kit';

export interface LogoCandidate {
  id: string; // "c0", "c1", …
  origin: LogoOrigin;
  sourceUrl: string | null;
  /** Trimmed RGBA PNG. */
  png: Buffer;
  width: number;
  height: number;
  aspect: number; // width / height
  hasTransparency: boolean;
  /** Solid backdrop colour if the asset has one (e.g. white text on a red tile). */
  backgroundHex: string | null;
  /** Mostly light pixels: designed for a dark header. */
  isLightOnTransparent: boolean;
  /** Designed square tile with its own backdrop (app icon / badge); used as-is. */
  isTile: boolean;
  /** Ranking from DOM heuristics / origin priors, before the vision check. */
  priorScore: number;
  derivedFrom?: string; // for symbol crops
  notes: string[];
}

import type { IconRecommendation, LogoAssessmentEntry } from '@wisemen/brand-kit';

export type { BrandExtractionResult, ExtractOptions, IconRecommendation } from '@wisemen/brand-kit';

export interface LogoAssessment {
  /** Candidate id judged to be the company's primary logo, or null. */
  bestLogoId: string | null;
  /** Candidate id that works best inside a square (may be a symbol crop or icon). */
  bestSquareId: string | null;
  recommendation: IconRecommendation;
  reason: string;
  perCandidate: LogoAssessmentEntry[];
  /** 'vision' when the model decided, 'heuristic' when it was unavailable. */
  decidedBy: 'vision' | 'heuristic';
}
