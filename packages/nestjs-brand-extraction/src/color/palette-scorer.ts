import {
  Rgb,
  deltaEOK,
  ensureReadableOn,
  isNeutral,
  rgbToOklab,
  rgbToOklch,
  toHex,
} from '@wisemen/brand-kit';

/**
 * Where a colour was observed. The weights encode how strongly each source
 * signals "this is the brand colour". Tune them against a labelled set of
 * customer sites (see AGENTS.md → "Tuning").
 */
export type EvidenceSource =
  | 'css-var-brand' // --primary / --brand / --color-accent …
  | 'theme-color' // <meta name="theme-color">
  | 'mask-icon' // <link rel="mask-icon" color="…">
  | 'tile-color' // msapplication-TileColor
  | 'button-bg' // filled buttons / CTAs
  | 'button-outline' // outline buttons (border colour)
  | 'header-bg' // header / nav background
  | 'link' // link text colour
  | 'logo' // pixels of the chosen logo
  | 'screenshot'; // above-the-fold pixels

export const SOURCE_WEIGHTS: Record<EvidenceSource, number> = {
  'css-var-brand': 3.5,
  'theme-color': 2.5,
  'mask-icon': 2,
  'tile-color': 1.5,
  'button-bg': 3,
  'button-outline': 1.5,
  'header-bg': 2,
  link: 1.5,
  logo: 4,
  screenshot: 1.5,
};

/** Sources that represent interactive UI; agreement with the logo is a strong signal. */
const UI_SOURCES: EvidenceSource[] = ['css-var-brand', 'button-bg', 'button-outline', 'link', 'header-bg'];

export interface ColorEvidence {
  rgb: Rgb;
  source: EvidenceSource;
  /** Relative strength within its source, 0–1 (e.g. pixel share, usage frequency). */
  strength: number;
  detail?: string;
}

export interface ScoredColor {
  hex: string;
  rgb: Rgb;
  score: number;
  neutral: boolean;
  sources: EvidenceSource[];
  /** Short human explanation, e.g. "logo + knoppen + theme-color". */
  explanation: string;
}

export interface PaletteResult {
  primary: ScoredColor | null;
  accent: ScoredColor | null;
  /** Ordered swatches for the picker (4–6), primary first. */
  swatches: ScoredColor[];
  /** Readability-adjusted primary for filled surfaces (monogram, welcome panel). */
  primarySurface: { hex: string; onColor: string; adjusted: boolean; contrast: number } | null;
  clusters: ScoredColor[];
}

const MERGE_DISTANCE = 0.045; // OKLab; ~2 JNDs
const ACCENT_MIN_DISTANCE = 0.12;

export function scorePalette(evidence: ColorEvidence[]): PaletteResult {
  const clusters = cluster(evidence).map(scoreCluster).sort((a, b) => b.score - a.score);

  const chromatic = clusters.filter((c) => !c.neutral);
  const primary = chromatic[0] ?? pickInk(clusters) ?? null;

  let accent: ScoredColor | null = null;
  if (primary) {
    // Second chromatic colour that is clearly different, and not negligible.
    accent =
      chromatic.find((c) => c !== primary && deltaEOK(c.rgb, primary.rgb) > ACCENT_MIN_DISTANCE && c.score > primary.score * 0.12) ??
      // Otherwise the brand's "ink": a dark, slightly tinted neutral (navy, charcoal).
      pickInk(clusters.filter((c) => c !== primary)) ??
      null;
  }

  const swatches: ScoredColor[] = [];
  for (const c of [primary, accent, ...clusters]) {
    if (!c || swatches.includes(c)) continue;
    if (swatches.some((s) => deltaEOK(s.rgb, c.rgb) < 0.08)) continue;
    if (isNearWhiteOrBlack(c.rgb) && swatches.length >= 2) continue;
    swatches.push(c);
    if (swatches.length === 6) break;
  }

  const surface = primary ? ensureReadableOn(primary.rgb) : null;

  return {
    primary,
    accent,
    swatches,
    primarySurface: surface && {
      hex: toHex(surface.background),
      onColor: toHex(surface.foreground),
      adjusted: surface.adjusted,
      contrast: Math.round(surface.ratio * 100) / 100,
    },
    clusters,
  };
}

// ---------------------------------------------------------------------------

interface Cluster {
  members: ColorEvidence[];
  centroid: Rgb;
}

/** Greedy agglomeration by OKLab distance, strongest evidence first. */
function cluster(evidence: ColorEvidence[]): Cluster[] {
  const sorted = [...evidence].sort(
    (a, b) => SOURCE_WEIGHTS[b.source] * b.strength - SOURCE_WEIGHTS[a.source] * a.strength,
  );
  const clusters: Cluster[] = [];
  for (const e of sorted) {
    const hit = clusters.find((c) => deltaEOK(c.centroid, e.rgb) < MERGE_DISTANCE);
    if (hit) hit.members.push(e);
    else clusters.push({ members: [e], centroid: e.rgb });
  }
  // The representative colour is the one from the most authoritative source
  // (a declared CSS value beats an anti-aliased pixel average), not a blend.
  for (const c of clusters) {
    const best = c.members.reduce((a, b) =>
      SOURCE_WEIGHTS[b.source] * (b.source === 'screenshot' ? 0.5 : 1) >
      SOURCE_WEIGHTS[a.source] * (a.source === 'screenshot' ? 0.5 : 1)
        ? b
        : a,
    );
    c.centroid = best.rgb;
  }
  return clusters;
}

function scoreCluster(c: Cluster): ScoredColor {
  const bySource = new Map<EvidenceSource, number>();
  for (const m of c.members) {
    // Diminishing returns within one source: 10 identical buttons ≠ 10× evidence.
    bySource.set(m.source, Math.min(1, (bySource.get(m.source) ?? 0) + m.strength));
  }

  let base = 0;
  for (const [src, s] of bySource) base += SOURCE_WEIGHTS[src] * Math.sqrt(s);

  const sources = [...bySource.keys()];
  const kinds = sources.length;
  let score = base * (1 + 0.3 * (kinds - 1));

  const inLogo = bySource.has('logo');
  const inUi = UI_SOURCES.some((s) => bySource.has(s));
  if (inLogo && inUi) score *= 1.5;

  const { L, C } = rgbToOklch(c.centroid);
  const neutral = isNeutral(c.centroid);
  // Favour saturated, mid-lightness colours as brand candidates.
  score *= neutral ? 0.35 : 0.55 + 0.45 * Math.min(1, C / 0.12);
  if (L > 0.9) score *= 0.5;

  return {
    hex: toHex(c.centroid),
    rgb: c.centroid,
    score: Math.round(score * 100) / 100,
    neutral,
    sources,
    explanation: explain(sources),
  };
}

/** A dark, tinted neutral that works as an accent/ink colour. */
function pickInk(clusters: ScoredColor[]): ScoredColor | undefined {
  return clusters.find((c) => {
    const { L, C } = rgbToOklch(c.rgb);
    return L > 0.12 && L < 0.42 && C < 0.09 && c.sources.some((s) => s !== 'screenshot');
  });
}

function isNearWhiteOrBlack(c: Rgb): boolean {
  const { L } = rgbToOklab(c);
  return L > 0.96 || L < 0.1;
}

const SOURCE_LABELS: Record<EvidenceSource, string> = {
  'css-var-brand': 'CSS-variabele',
  'theme-color': 'theme-color',
  'mask-icon': 'mask-icon',
  'tile-color': 'tile-kleur',
  'button-bg': 'knoppen',
  'button-outline': 'knoprand',
  'header-bg': 'header',
  link: 'links',
  logo: 'logo',
  screenshot: 'homepage',
};

function explain(sources: EvidenceSource[]): string {
  return sources.map((s) => SOURCE_LABELS[s]).join(' + ');
}

/** Exposed for tests / debugging. */
export const _internal = { cluster };
