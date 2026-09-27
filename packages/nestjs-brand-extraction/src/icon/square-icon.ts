import sharp from 'sharp';
import { Rgb, WHITE, contrastRatio, parseCssColor, toHex } from '@wisemen/brand-kit';

export interface SquareIconOptions {
  size?: number;
  /** Fraction of the canvas kept free on each side (optical safe zone). */
  padding?: number;
  /** Backdrop the logo was designed on, if any (from analysis). */
  logoBackground?: string | null;
  /** Primary brand colour, used as backdrop for light-on-transparent logos. */
  brandColor?: string | null;
  /** The asset is already a designed square tile: fill the canvas, no extra padding. */
  isTile?: boolean;
}

export interface SquareIcon {
  png: Buffer;
  background: string;
}

const INK_FALLBACK: Rgb = { r: 17, g: 24, b: 39 };

/**
 * Places a (trimmed) logo in a square with a consistent safe zone, so every
 * customer icon has the same visual weight in lists and avatars.
 *
 * Backdrop choice:
 *  1. The logo's own solid backdrop (app icons, badge-style logos)
 *  2. White, if the logo has enough contrast on white
 *  3. The brand colour, or a dark ink, for light logos made for dark headers
 */
export async function composeSquareIcon(logoPng: Buffer, opts: SquareIconOptions = {}): Promise<SquareIcon> {
  const { size = 512, logoBackground, brandColor } = opts;
  if (opts.isTile) {
    const png = await sharp(logoPng).resize(size, size, { fit: 'cover', kernel: 'lanczos3' }).png({ compressionLevel: 9 }).toBuffer();
    return { png, background: logoBackground ?? '#FFFFFF' };
  }

  const meta = await sharp(logoPng).metadata();
  const aspect = (meta.width ?? 1) / (meta.height ?? 1);

  // Wider logos get less padding so they don't shrink to a sliver.
  const padding = opts.padding ?? (aspect > 2.2 ? 0.1 : aspect > 1.3 ? 0.14 : 0.18);
  const box = Math.round(size * (1 - 2 * padding));

  const background = logoBackground
    ? parseCssColor(logoBackground)!
    : await chooseBackdrop(logoPng, brandColor);

  const resized = await sharp(logoPng)
    .resize(box, box, { fit: 'inside', kernel: 'lanczos3' })
    .png()
    .toBuffer();

  const png = await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: Math.round(background.r), g: Math.round(background.g), b: Math.round(background.b), alpha: 1 },
    },
  })
    .composite([{ input: resized, gravity: 'centre' }])
    .png({ compressionLevel: 9 })
    .toBuffer();

  return { png, background: toHex(background) };
}

async function chooseBackdrop(logoPng: Buffer, brandColor?: string | null): Promise<Rgb> {
  const ink = await dominantInk(logoPng);
  if (!ink) return WHITE;
  if (contrastRatio(ink, WHITE) >= 2) return WHITE;
  const brand = brandColor ? parseCssColor(brandColor) : null;
  if (brand && contrastRatio(ink, brand) >= 3) return brand;
  return INK_FALLBACK;
}

/** Alpha-weighted mean colour of the visible pixels. */
async function dominantInk(png: Buffer): Promise<Rgb | null> {
  const { data } = await sharp(png).resize(64, 64, { fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let r = 0, g = 0, b = 0, w = 0;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] / 255;
    if (a < 0.2) continue;
    r += data[i] * a; g += data[i + 1] * a; b += data[i + 2] * a; w += a;
  }
  if (!w) return null;
  return { r: r / w, g: g / w, b: b / w };
}
