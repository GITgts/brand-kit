import sharp from 'sharp';
import { Oklab, Rgb, oklabToRgb, rgbToOklab } from '@wisemen/brand-kit';

export interface PaletteEntry {
  rgb: Rgb;
  /** Share of (non-transparent) pixels, 0–1. */
  share: number;
}

export interface ImagePaletteOptions {
  /** Longest side after downscaling. 96–160 is plenty for palette work. */
  maxSide?: number;
  k?: number;
  /** Pixels with alpha below this (0–255) are ignored. */
  alphaThreshold?: number;
  /** Optional region of interest in source pixels. */
  region?: { left: number; top: number; width: number; height: number };
}

/**
 * Extracts a palette from an image with deterministic weighted k-means in OKLab.
 *
 * Pixels are first binned to 5 bits per channel (32k bins max), so k-means runs
 * on a few hundred weighted points rather than tens of thousands of pixels.
 * Initialisation is deterministic ("farthest weighted point"), so the same input
 * always produces the same palette — important for caching and tests.
 */
export async function extractImagePalette(input: Buffer, opts: ImagePaletteOptions = {}): Promise<PaletteEntry[]> {
  const { maxSide = 128, k = 8, alphaThreshold = 128, region } = opts;

  let img = sharp(input, { failOn: 'none' });
  if (region) img = img.extract(region);
  const { data, info } = await img
    .resize(maxSide, maxSide, { fit: 'inside', withoutEnlargement: true, kernel: 'nearest' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // 1. Histogram into 5-bit bins.
  const bins = new Map<number, { r: number; g: number; b: number; n: number }>();
  let total = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    if (data[i + 3] < alphaThreshold) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const bin = bins.get(key);
    if (bin) { bin.r += r; bin.g += g; bin.b += b; bin.n++; }
    else bins.set(key, { r, g, b, n: 1 });
    total++;
  }
  if (total === 0) return [];

  const points = [...bins.values()].map((bin) => ({
    lab: rgbToOklab({ r: bin.r / bin.n, g: bin.g / bin.n, b: bin.b / bin.n }),
    w: bin.n,
  }));

  const kk = Math.min(k, points.length);
  const dist2 = (p: Oklab, q: Oklab) => (p.L - q.L) ** 2 + (p.a - q.a) ** 2 + (p.b - q.b) ** 2;

  // 2. Deterministic seeding: heaviest bin, then maximise weight × distance².
  const centroids: Oklab[] = [points.reduce((a, b) => (b.w > a.w ? b : a)).lab];
  while (centroids.length < kk) {
    let best = points[0], bestScore = -1;
    for (const p of points) {
      const d = Math.min(...centroids.map((c) => dist2(p.lab, c)));
      const score = d * Math.sqrt(p.w);
      if (score > bestScore) { bestScore = score; best = p; }
    }
    if (bestScore <= 0) break;
    centroids.push(best.lab);
  }

  // 3. Lloyd iterations.
  const assign = new Array<number>(points.length).fill(0);
  for (let iter = 0; iter < 16; iter++) {
    let moved = false;
    points.forEach((p, i) => {
      let bi = 0, bd = Infinity;
      centroids.forEach((c, ci) => {
        const d = dist2(p.lab, c);
        if (d < bd) { bd = d; bi = ci; }
      });
      if (assign[i] !== bi) { assign[i] = bi; moved = true; }
    });
    const sums = centroids.map(() => ({ L: 0, a: 0, b: 0, w: 0 }));
    points.forEach((p, i) => {
      const s = sums[assign[i]];
      s.L += p.lab.L * p.w; s.a += p.lab.a * p.w; s.b += p.lab.b * p.w; s.w += p.w;
    });
    sums.forEach((s, ci) => {
      if (s.w > 0) centroids[ci] = { L: s.L / s.w, a: s.a / s.w, b: s.b / s.w };
    });
    if (!moved && iter > 0) break;
  }

  const weights = centroids.map(() => 0);
  points.forEach((p, i) => (weights[assign[i]] += p.w));

  return centroids
    .map((c, i) => ({ rgb: oklabToRgb(c), share: weights[i] / total }))
    .filter((e) => e.share > 0)
    .sort((a, b) => b.share - a.share);
}
