import { readFileSync } from 'node:fs';
import * as opentype from 'opentype.js';
import { ensureReadableOn, parseCssColor, toHex } from '@wisemen/brand-kit';

/**
 * The fixed WiseOS "Vierkant icoon": 1–2 letters on the customer's primary
 * colour. Letters are converted to outlines with the brand font, so the SVG
 * looks identical everywhere (browser, PDF, rasterised PNG) without the font
 * being installed. Corner radius is NOT baked in — apply it in the UI so every
 * surface (avatar, sidebar, favicon) can use its own radius.
 */

export { deriveMonogramLetters } from '@wisemen/brand-kit';

export interface MonogramOptions {
  letters: string;
  /** Any CSS colour; adjusted for WCAG AA with the letter colour if needed. */
  background: string;
  size?: number;
  fontPath?: string;
}

export interface Monogram {
  svg: string;
  background: string;
  foreground: string;
  adjusted: boolean;
}

const fontCache = new Map<string, opentype.Font>();
function loadFont(path: string): opentype.Font {
  let font = fontCache.get(path);
  if (!font) {
    const buf = readFileSync(path);
    font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
    fontCache.set(path, font);
  }
  return font;
}

export function buildMonogramSvg({ letters, background, size = 512, fontPath }: MonogramOptions): Monogram {
  const text = letters.trim().slice(0, 3) || '?';
  const bgRgb = parseCssColor(background) ?? { r: 79, g: 70, b: 229, a: 1 };
  const readable = ensureReadableOn(bgRgb);
  const bg = toHex(readable.background);
  const fg = toHex(readable.foreground);

  // Glyph box targets, tuned so 1, 2 and 3 letters feel equally heavy.
  const maxW = size * ({ 1: 0.5, 2: 0.62, 3: 0.7 } as Record<number, number>)[text.length];
  const maxH = size * ({ 1: 0.5, 2: 0.4, 3: 0.3 } as Record<number, number>)[text.length];

  let content: string;
  if (fontPath) {
    const font = loadFont(fontPath);
    // Measure at a reference size, then scale to fit the target box.
    const ref = 1000;
    const probe = font.getPath(text, 0, 0, ref, { kerning: true });
    const bb = probe.getBoundingBox();
    const scale = Math.min(maxW / (bb.x2 - bb.x1), maxH / (bb.y2 - bb.y1));
    const fontSize = ref * scale;
    // Optical centring: centre the actual ink box, not the em box.
    const x = size / 2 - ((bb.x1 + bb.x2) / 2) * scale;
    const y = size / 2 - ((bb.y1 + bb.y2) / 2) * scale;
    const path = font.getPath(text, x, y, fontSize, { kerning: true });
    content = `<path d="${path.toPathData(2)}" fill="${fg}"/>`;
  } else {
    // Fallback without a font file: live text with the system stack.
    const fontSize = Math.round(maxH / 0.72);
    content =
      `<text x="50%" y="50%" dominant-baseline="central" text-anchor="middle" ` +
      `font-family="Inter, 'Helvetica Neue', Arial, sans-serif" font-weight="700" ` +
      `font-size="${fontSize}" letter-spacing="${text.length > 1 ? -fontSize * 0.02 : 0}" fill="${fg}">${escapeXml(text)}</text>`;
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${escapeXml(text)}">` +
    `<rect width="${size}" height="${size}" fill="${bg}"/>${content}</svg>`;

  return { svg, background: bg, foreground: fg, adjusted: readable.adjusted };
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);
}
