/**
 * Dependency-free colour math.
 *
 * All perceptual work (clustering, distance, lightening/darkening) happens in
 * OKLab / OKLCH, which is far more uniform than HSL. Contrast checks use the
 * WCAG 2.x relative-luminance formula, because that is what auditors test.
 */

export interface Rgb {
  r: number; // 0–255
  g: number;
  b: number;
}

export interface Rgba extends Rgb {
  a: number; // 0–1
}

export interface Oklab {
  L: number; // 0–1
  a: number;
  b: number;
}

export interface Oklch {
  L: number; // 0–1
  C: number; // 0–~0.37
  h: number; // degrees 0–360
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Parses the colour strings we get back from `getComputedStyle` and HTML
 * attributes: #rgb, #rgba, #rrggbb, #rrggbbaa, rgb()/rgba() (comma or space
 * syntax, percentages), color(srgb …) and oklch(…). Chrome returns the latter
 * two for colours that were authored in those spaces.
 */
export function parseCssColor(input: string | null | undefined): Rgba | null {
  if (!input) return null;
  const s = input.trim().toLowerCase();
  if (!s || s === 'transparent' || s === 'none' || s === 'currentcolor') return null;

  if (s.startsWith('#')) return parseHex(s);

  const fn = /^([a-z-]+)\((.*)\)$/.exec(s);
  if (!fn) return null;
  const [, name, body] = fn;
  const { parts, alpha } = splitFnArgs(body);

  if (name === 'rgb' || name === 'rgba') {
    if (parts.length < 3) return null;
    const ch = parts.slice(0, 3).map((p) => (p.endsWith('%') ? (parseFloat(p) / 100) * 255 : parseFloat(p)));
    if (ch.some(Number.isNaN)) return null;
    return { r: clamp(ch[0], 0, 255), g: clamp(ch[1], 0, 255), b: clamp(ch[2], 0, 255), a: alpha };
  }

  if (name === 'color') {
    // color(srgb r g b / a) — values 0–1
    if (parts[0] !== 'srgb' || parts.length < 4) return null;
    const ch = parts.slice(1, 4).map((p) => (p.endsWith('%') ? parseFloat(p) / 100 : parseFloat(p)));
    if (ch.some(Number.isNaN)) return null;
    return { r: clamp(ch[0] * 255, 0, 255), g: clamp(ch[1] * 255, 0, 255), b: clamp(ch[2] * 255, 0, 255), a: alpha };
  }

  if (name === 'oklch') {
    if (parts.length < 3) return null;
    const L = parts[0].endsWith('%') ? parseFloat(parts[0]) / 100 : parseFloat(parts[0]);
    const C = parts[1].endsWith('%') ? (parseFloat(parts[1]) / 100) * 0.4 : parseFloat(parts[1]);
    const h = parts[2] === 'none' ? 0 : parseFloat(parts[2]);
    if ([L, C, h].some(Number.isNaN)) return null;
    return { ...oklchToRgb({ L, C, h }), a: alpha };
  }

  return null;
}

function splitFnArgs(body: string): { parts: string[]; alpha: number } {
  let alpha = 1;
  let main = body;
  const slash = body.indexOf('/');
  if (slash >= 0) {
    main = body.slice(0, slash);
    alpha = parseAlpha(body.slice(slash + 1).trim());
  }
  const parts = main.split(/[\s,]+/).filter(Boolean);
  // legacy rgba(r, g, b, a)
  if (slash < 0 && parts.length === 4 && !parts[0].startsWith('srgb')) {
    alpha = parseAlpha(parts[3]);
    parts.length = 3;
  }
  return { parts, alpha };
}

function parseAlpha(v: string): number {
  const n = v.endsWith('%') ? parseFloat(v) / 100 : parseFloat(v);
  return Number.isNaN(n) ? 1 : clamp(n, 0, 1);
}

function parseHex(s: string): Rgba | null {
  let h = s.slice(1);
  if (![3, 4, 6, 8].includes(h.length) || /[^0-9a-f]/.test(h)) return null;
  if (h.length <= 4) h = [...h].map((c) => c + c).join('');
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
  return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
}

export function toHex({ r, g, b }: Rgb): string {
  const x = (v: number) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0');
  return `#${x(r)}${x(g)}${x(b)}`.toUpperCase();
}

// ---------------------------------------------------------------------------
// sRGB <-> OKLab <-> OKLCH
// ---------------------------------------------------------------------------

const toLinear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (v: number) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

export function rgbToOklab({ r, g, b }: Rgb): Oklab {
  const lr = toLinear(r), lg = toLinear(g), lb = toLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

/** Unclamped linear-sRGB result, used for gamut checks. */
function oklabToLinearRgb({ L, a, b }: Oklab): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

export function oklabToRgb(lab: Oklab): Rgb {
  const [r, g, b] = oklabToLinearRgb(lab);
  return { r: clamp(fromLinear(r), 0, 255), g: clamp(fromLinear(g), 0, 255), b: clamp(fromLinear(b), 0, 255) };
}

export function oklabToOklch({ L, a, b }: Oklab): Oklch {
  const C = Math.hypot(a, b);
  let h = (Math.atan2(b, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { L, C, h };
}

export function oklchToOklab({ L, C, h }: Oklch): Oklab {
  const rad = (h * Math.PI) / 180;
  return { L, a: C * Math.cos(rad), b: C * Math.sin(rad) };
}

export const rgbToOklch = (c: Rgb) => oklabToOklch(rgbToOklab(c));

/**
 * OKLCH -> sRGB with chroma reduction (hue and lightness preserved) when the
 * colour is out of gamut, instead of naive per-channel clipping which shifts hue.
 */
export function oklchToRgb(lch: Oklch): Rgb {
  const inGamut = (c: Oklch) => oklabToLinearRgb(oklchToOklab(c)).every((v) => v >= -1e-4 && v <= 1 + 1e-4);
  if (inGamut(lch)) return oklabToRgb(oklchToOklab(lch));
  let lo = 0, hi = lch.C;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut({ ...lch, C: mid })) lo = mid;
    else hi = mid;
  }
  return oklabToRgb(oklchToOklab({ ...lch, C: lo }));
}

/** Euclidean distance in OKLab. ~0.02 is a just-noticeable difference. */
export function deltaEOK(x: Rgb, y: Rgb): number {
  const a = rgbToOklab(x), b = rgbToOklab(y);
  return Math.hypot(a.L - b.L, a.a - b.a, a.b - b.b);
}

// ---------------------------------------------------------------------------
// WCAG contrast
// ---------------------------------------------------------------------------

export function relativeLuminance({ r, g, b }: Rgb): number {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

export function contrastRatio(x: Rgb, y: Rgb): number {
  const a = relativeLuminance(x), b = relativeLuminance(y);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

export const WHITE: Rgb = { r: 255, g: 255, b: 255 };
export const INK: Rgb = { r: 11, g: 11, b: 15 };

/**
 * Picks white or ink text for a background. If neither reaches `minRatio`,
 * darkens the background in OKLCH (hue kept) until white text passes.
 * Returns the (possibly adjusted) background.
 */
export function ensureReadableOn(
  background: Rgb,
  minRatio = 4.5,
): { background: Rgb; foreground: Rgb; adjusted: boolean; ratio: number } {
  const onWhite = contrastRatio(background, WHITE);
  const onInk = contrastRatio(background, INK);
  // Prefer white text: brand icons read as "badges"; ink only for clearly light colours.
  if (onWhite >= minRatio) return { background, foreground: WHITE, adjusted: false, ratio: onWhite };
  if (onInk >= minRatio && rgbToOklch(background).L > 0.72) {
    return { background, foreground: INK, adjusted: false, ratio: onInk };
  }
  const lch = rgbToOklch(background);
  let lo = 0, hi = lch.L;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (contrastRatio(oklchToRgb({ ...lch, L: mid }), WHITE) >= minRatio) lo = mid;
    else hi = mid;
  }
  const adjustedBg = oklchToRgb({ ...lch, L: lo });
  return { background: adjustedBg, foreground: WHITE, adjusted: true, ratio: contrastRatio(adjustedBg, WHITE) };
}

// ---------------------------------------------------------------------------
// Classification helpers
// ---------------------------------------------------------------------------

/** Near-greys, near-whites and near-blacks. */
export function isNeutral(c: Rgb, chromaThreshold = 0.035): boolean {
  const { L, C } = rgbToOklch(c);
  return C < chromaThreshold || L > 0.97 || L < 0.12;
}

/** Composites an RGBA colour over an opaque backdrop. */
export function flatten(c: Rgba, over: Rgb = WHITE): Rgb {
  return {
    r: c.r * c.a + over.r * (1 - c.a),
    g: c.g * c.a + over.g * (1 - c.a),
    b: c.b * c.a + over.b * (1 - c.a),
  };
}
