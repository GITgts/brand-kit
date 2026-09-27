import sharp from 'sharp';
import { Rgb, deltaEOK, rgbToOklab, toHex } from '@wisemen/brand-kit';

export interface AnalyzedLogo {
  png: Buffer; // trimmed RGBA PNG
  width: number;
  height: number;
  aspect: number;
  hasTransparency: boolean;
  backgroundHex: string | null;
  isLightOnTransparent: boolean;
  /**
   * A designed square tile (app icon, badge): solid backdrop and ~square. Kept
   * untrimmed, because the backdrop and its margins are part of the design.
   */
  isTile: boolean;
}

export interface SymbolCrop {
  png: Buffer;
  layout: 'symbol-left' | 'symbol-right' | 'symbol-top';
}

const RASTER_TARGET = 1024;

// ---------------------------------------------------------------------------
// Rasterisation
// ---------------------------------------------------------------------------

/**
 * Turns whatever the site serves (SVG, PNG, JPEG, WebP, GIF, AVIF, ICO) into an
 * RGBA PNG whose longest side is ~1024 px (never upscaled for bitmaps).
 * Returns null for formats we can't decode.
 */
export async function rasterize(body: Buffer, contentType = '', url = ''): Promise<Buffer | null> {
  try {
    const isSvg = contentType.includes('svg') || /\.svgz?(\?|#|$)/i.test(url) || looksLikeSvg(body);
    if (isSvg) return await rasterizeSvg(body);

    const isIco = contentType.includes('icon') || /\.ico(\?|#|$)/i.test(url) || isIcoMagic(body);
    if (isIco) {
      const png = extractLargestPngFromIco(body);
      if (!png) return null;
      body = png;
    }

    const img = sharp(body, { failOn: 'none', animated: false });
    const meta = await img.metadata();
    if (!meta.width || !meta.height) return null;
    return await img
      .resize(RASTER_TARGET, RASTER_TARGET, { fit: 'inside', withoutEnlargement: true })
      .ensureAlpha()
      .png()
      .toBuffer();
  } catch {
    return null;
  }
}

function looksLikeSvg(body: Buffer): boolean {
  const head = body.subarray(0, 512).toString('utf8').trimStart().toLowerCase();
  return head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'));
}

async function rasterizeSvg(body: Buffer): Promise<Buffer | null> {
  const probe = await sharp(body, { failOn: 'none' }).metadata();
  const longest = Math.max(probe.width ?? 0, probe.height ?? 0) || 300;
  // librsvg renders at 72 dpi by default; scale density so the longest side ≈ 1024 px.
  const density = Math.min(2400, Math.max(72, (72 * RASTER_TARGET) / longest));
  return sharp(body, { density, failOn: 'none' })
    .resize(RASTER_TARGET, RASTER_TARGET, { fit: 'inside' })
    .ensureAlpha()
    .png()
    .toBuffer();
}

function isIcoMagic(b: Buffer): boolean {
  return b.length > 6 && b.readUInt16LE(0) === 0 && b.readUInt16LE(2) === 1;
}

/** ICO files often embed PNGs; BMP-encoded entries are skipped (too low-res to matter). */
function extractLargestPngFromIco(b: Buffer): Buffer | null {
  if (!isIcoMagic(b)) return null;
  const count = b.readUInt16LE(4);
  let best: { size: number; data: Buffer } | null = null;
  for (let i = 0; i < count; i++) {
    const off = 6 + i * 16;
    if (off + 16 > b.length) break;
    const w = b[off] || 256;
    const len = b.readUInt32LE(off + 8);
    const dataOff = b.readUInt32LE(off + 12);
    if (dataOff + len > b.length) continue;
    const data = b.subarray(dataOff, dataOff + len);
    const isPng = data.length > 8 && data.readUInt32BE(0) === 0x89504e47;
    if (isPng && (!best || w > best.size)) best = { size: w, data };
  }
  return best?.data ?? null;
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

export async function analyzeLogo(png: Buffer): Promise<AnalyzedLogo | null> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  if (width < 8 || height < 8) return null;

  let transparent = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 250) transparent++;
  const hasTransparency = transparent / (width * height) > 0.02;

  const backgroundRgb = detectSolidBackground(data, width, height);
  const backgroundHex = backgroundRgb ? toHex(backgroundRgb) : null;
  const isTile = !!backgroundRgb && width / height > 0.8 && width / height < 1.25;

  // Trim the empty frame (transparent, or the solid backdrop colour).
  let trimmed: Buffer;
  if (isTile) trimmed = png;
  else try {
    trimmed = await sharp(png)
      .trim(backgroundRgb ? { background: backgroundHex!, threshold: 18 } : { threshold: 10 })
      .png()
      .toBuffer();
  } catch {
    trimmed = png; // sharp throws when the image is uniform
  }
  const tMeta = await sharp(trimmed).metadata();
  const tw = tMeta.width ?? width;
  const th = tMeta.height ?? height;

  // Content that is almost entirely light on a transparent background was made for a dark header.
  let lSum = 0, aSum = 0;
  const { data: td } = await sharp(trimmed).resize(64, 64, { fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < td.length; i += 4) {
    const a = td[i + 3] / 255;
    if (a < 0.1) continue;
    lSum += rgbToOklab({ r: td[i], g: td[i + 1], b: td[i + 2] }).L * a;
    aSum += a;
  }
  const meanL = aSum ? lSum / aSum : 0;

  return {
    png: trimmed,
    width: tw,
    height: th,
    aspect: tw / th,
    hasTransparency,
    backgroundHex,
    isLightOnTransparent: hasTransparency && !backgroundRgb && meanL > 0.88,
    isTile,
  };
}

/** Returns the backdrop colour if ≥ 90 % of the 2px border is one opaque colour. */
function detectSolidBackground(data: Buffer, width: number, height: number): Rgb | null {
  const samples: Rgb[] = [];
  let opaque = 0, total = 0;
  const push = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    total++;
    if (data[i + 3] >= 245) {
      opaque++;
      samples.push({ r: data[i], g: data[i + 1], b: data[i + 2] });
    }
  };
  const step = Math.max(1, Math.floor(Math.max(width, height) / 200));
  for (let x = 0; x < width; x += step) for (const y of [0, 1, height - 2, height - 1]) push(x, y);
  for (let y = 0; y < height; y += step) for (const x of [0, 1, width - 2, width - 1]) push(x, y);
  if (total === 0 || opaque / total < 0.9) return null;

  // Median per channel is robust against a few anti-aliased pixels.
  const med = (k: keyof Rgb) => samples.map((s) => s[k]).sort((a, b) => a - b)[samples.length >> 1];
  const median = { r: med('r'), g: med('g'), b: med('b') };
  const close = samples.filter((s) => deltaEOK(s, median) < 0.03).length;
  return close / samples.length >= 0.9 ? median : null;
}

// ---------------------------------------------------------------------------
// Symbol extraction from combination marks
// ---------------------------------------------------------------------------

/**
 * Many logos are "symbol + wordmark" side by side (or stacked). The symbol
 * alone is what works in a square. We find it by looking for the dominant
 * empty gap in the ink mask. The vision check verifies every crop, so this can
 * afford to be a bit eager.
 */
export async function findSymbolCrops(logo: AnalyzedLogo): Promise<SymbolCrop[]> {
  const { data, info } = await sharp(logo.png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const bg = logo.backgroundHex ? hexToRgb(logo.backgroundHex) : null;

  const ink = new Uint8Array(w * h);
  for (let p = 0, i = 0; p < w * h; p++, i += 4) {
    if (data[i + 3] < 64) continue;
    if (bg && Math.abs(data[i] - bg.r) + Math.abs(data[i + 1] - bg.g) + Math.abs(data[i + 2] - bg.b) < 40) continue;
    ink[p] = 1;
  }

  const crops: SymbolCrop[] = [];

  if (logo.aspect > 1.6) {
    const cols = new Array<number>(w).fill(0);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) cols[x] += ink[y * w + x];
    const segs = segments(cols, Math.max(1, h * 0.01), Math.max(3, Math.round(w * 0.03)));
    if (segs) {
      const [first, last] = [segs.parts[0], segs.parts[segs.parts.length - 1]];
      const candidates: [typeof first, SymbolCrop['layout']][] = [[first, 'symbol-left'], [last, 'symbol-right']];
      for (const [seg, layout] of candidates) {
        const box = inkBox(ink, w, h, seg.start, 0, seg.end, h);
        if (!box) continue;
        const aspect = box.width / box.height;
        const rest = w - box.width;
        if (aspect >= 0.55 && aspect <= 1.8 && box.width <= w * 0.45 && rest >= box.width * 1.2) {
          crops.push({ png: await cropPng(logo.png, box), layout });
        }
      }
    }
  }

  if (logo.aspect < 1.4 && logo.aspect > 0.5) {
    const rows = new Array<number>(h).fill(0);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rows[y] += ink[y * w + x];
    const segs = segments(rows, Math.max(1, w * 0.01), Math.max(3, Math.round(h * 0.04)));
    if (segs && segs.parts.length >= 2) {
      const top = segs.parts[0];
      const box = inkBox(ink, w, h, 0, top.start, w, top.end);
      const bottom = inkBox(ink, w, h, 0, segs.parts[1].start, w, segs.parts[segs.parts.length - 1].end);
      if (box && bottom) {
        const aspect = box.width / box.height;
        if (aspect >= 0.55 && aspect <= 1.8 && box.height <= h * 0.75 && bottom.width / bottom.height > 2.2) {
          crops.push({ png: await cropPng(logo.png, box), layout: 'symbol-top' });
        }
      }
    }
  }

  return crops;
}

/**
 * Splits a 1-D ink profile at empty runs. Only returns a split if the largest
 * gap is clearly dominant (≥ 2× the median gap), so letter spacing inside a
 * wordmark doesn't produce a fake "symbol".
 */
function segments(profile: number[], minInk: number, minGap: number) {
  const parts: { start: number; end: number }[] = [];
  const gaps: number[] = [];
  let i = 0;
  while (i < profile.length && profile[i] < minInk) i++;
  while (i < profile.length) {
    const start = i;
    while (i < profile.length && profile[i] >= minInk) i++;
    const end = i;
    let g = 0;
    while (i < profile.length && profile[i] < minInk) { i++; g++; }
    parts.push({ start, end });
    if (i < profile.length) gaps.push(g);
  }
  if (parts.length < 2 || gaps.length === 0) return null;
  const sorted = [...gaps].sort((a, b) => a - b);
  const largest = sorted[sorted.length - 1];
  const median = sorted[Math.floor((sorted.length - 1) / 2)];
  if (largest < minGap || (gaps.length > 1 && largest < median * 2)) return null;

  // Merge everything except across the largest gap(s) → [left/top block, …].
  const merged: { start: number; end: number }[] = [{ ...parts[0] }];
  gaps.forEach((g, idx) => {
    if (g >= largest * 0.9) merged.push({ ...parts[idx + 1] });
    else merged[merged.length - 1].end = parts[idx + 1].end;
  });
  return merged.length >= 2 ? { parts: merged } : null;
}

function inkBox(ink: Uint8Array, w: number, h: number, x0: number, y0: number, x1: number, y1: number) {
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (!ink[y * w + x]) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

async function cropPng(png: Buffer, box: { left: number; top: number; width: number; height: number }) {
  return sharp(png).extract(box).png().toBuffer();
}

function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

// ---------------------------------------------------------------------------
// Dedupe
// ---------------------------------------------------------------------------

/** 64-bit difference hash on the alpha-flattened image; robust to scaling. */
export async function dHash(png: Buffer): Promise<bigint> {
  const { data } = await sharp(png)
    .flatten({ background: '#ffffff' })
    .greyscale()
    .resize(9, 8, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  let hash = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      hash = (hash << 1n) | (data[y * 9 + x] > data[y * 9 + x + 1] ? 1n : 0n);
    }
  }
  return hash;
}

export function hamming(a: bigint, b: bigint): number {
  let x = a ^ b, n = 0;
  while (x) { n += Number(x & 1n); x >>= 1n; }
  return n;
}

/** True when the visible pixels are (nearly) all one dark colour — typical for `currentColor` SVGs. */
export async function isMonochromeDark(png: Buffer): Promise<boolean> {
  const { data } = await sharp(png).resize(48, 48, { fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let visible = 0, dark = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    visible++;
    const { L, a, b } = rgbToOklab({ r: data[i], g: data[i + 1], b: data[i + 2] });
    if (L < 0.25 && Math.hypot(a, b) < 0.03) dark++;
  }
  return visible > 0 && dark / visible > 0.95;
}
