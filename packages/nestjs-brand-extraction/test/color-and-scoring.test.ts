import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  WHITE,
  contrastRatio,
  deltaEOK,
  ensureReadableOn,
  oklchToRgb,
  parseCssColor,
  rgbToOklch,
  toHex,
} from '@wisemen/brand-kit';
import { ColorEvidence, scorePalette } from '../src/color/palette-scorer';
import { isPublicAddress } from '../src/net/address-guard';
import { deriveMonogramLetters } from '../src/icon/monogram';
import { normalizeWebsite } from '../src/brand-extraction.service';

const rgb = (hex: string) => {
  const c = parseCssColor(hex)!;
  return { r: c.r, g: c.g, b: c.b };
};

describe('parseCssColor', () => {
  it('parses the formats browsers return', () => {
    assert.equal(toHex(parseCssColor('#c8102e')!), '#C8102E');
    assert.equal(toHex(parseCssColor('#abc')!), '#AABBCC');
    assert.equal(toHex(parseCssColor('rgb(200, 16, 46)')!), '#C8102E');
    assert.equal(toHex(parseCssColor('rgb(200 16 46 / 50%)')!), '#C8102E');
    assert.equal(parseCssColor('rgba(0, 0, 0, 0)')!.a, 0);
    assert.equal(parseCssColor('rgba(10, 20, 30, 0.4)')!.a, 0.4);
    assert.equal(toHex(parseCssColor('color(srgb 1 0 0)')!), '#FF0000');
    assert.ok(deltaEOK(parseCssColor('oklch(0.628 0.2577 29.23)')!, rgb('#FF0000')) < 0.01);
    assert.equal(parseCssColor('transparent'), null);
    assert.equal(parseCssColor('var(--x)'), null);
  });
});

describe('OKLCH & contrast', () => {
  it('round-trips and gamut-maps without hue shift', () => {
    const lch = rgbToOklch(rgb('#C8102E'));
    assert.ok(deltaEOK(oklchToRgb(lch), rgb('#C8102E')) < 0.002);
    const wild = oklchToRgb({ L: 0.7, C: 0.4, h: 150 }); // far out of sRGB
    assert.ok(Math.abs(rgbToOklch(wild).h - 150) < 3);
  });

  it('keeps readable brand colours and fixes unreadable ones', () => {
    const red = ensureReadableOn(rgb('#C8102E'));
    assert.equal(red.adjusted, false);
    assert.equal(toHex(red.foreground), '#FFFFFF');

    const yellow = ensureReadableOn(rgb('#FFD500'));
    assert.equal(toHex(yellow.foreground), '#0B0B0F'); // light colour → ink letters, colour untouched

    const orange = ensureReadableOn(rgb('#FF8A00')); // neither white nor ink is great
    assert.ok(orange.ratio >= 4.5);
    assert.ok(contrastRatio(orange.background, orange.foreground) >= 4.5);
    assert.ok(Math.abs(rgbToOklch(orange.background).h - rgbToOklch(rgb('#FF8A00')).h) < 6);
  });
});

describe('isPublicAddress', () => {
  it('blocks internal ranges', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1', '192.0.2.10']) {
      assert.equal(isPublicAddress(ip), false, ip);
    }
  });
  it('allows public addresses', () => {
    for (const ip of ['8.8.8.8', '192.0.78.9', '172.32.0.1', '2a00:1450:4001::1']) {
      assert.equal(isPublicAddress(ip), true, ip);
    }
  });
});

describe('scorePalette', () => {
  it('finds a Brantano-like primary + ink accent', () => {
    const e: ColorEvidence[] = [
      { rgb: rgb('#C8102E'), source: 'logo', strength: 0.8 },
      { rgb: rgb('#C9112F'), source: 'button-bg', strength: 0.7 }, // anti-aliased twin → merged
      { rgb: rgb('#C8102E'), source: 'theme-color', strength: 1 },
      { rgb: rgb('#1F2937'), source: 'link', strength: 0.6 },
      { rgb: rgb('#1F2937'), source: 'header-bg', strength: 1 },
      { rgb: rgb('#E8DFD0'), source: 'screenshot', strength: 0.3 },
      { rgb: rgb('#FFFFFF'), source: 'screenshot', strength: 1 },
      { rgb: rgb('#2BB673'), source: 'screenshot', strength: 0.05 }, // a stray green photo pixel
    ];
    const p = scorePalette(e);
    assert.equal(p.primary?.hex, '#C8102E');
    assert.equal(p.accent?.hex, '#1F2937');
    assert.equal(p.swatches[0].hex, '#C8102E');
    assert.ok(p.primary!.sources.includes('button-bg'));
    assert.equal(p.primarySurface?.onColor, '#FFFFFF');
  });

  it('prefers the colour shared by logo and UI over a louder screenshot colour', () => {
    const p = scorePalette([
      { rgb: rgb('#0057B8'), source: 'logo', strength: 0.6 },
      { rgb: rgb('#0057B8'), source: 'button-bg', strength: 0.5 },
      { rgb: rgb('#F59E0B'), source: 'screenshot', strength: 1 }, // big hero photo
    ]);
    assert.equal(p.primary?.hex, '#0057B8');
  });

  it('returns nulls when there is no evidence', () => {
    const p = scorePalette([]);
    assert.equal(p.primary, null);
    assert.equal(p.swatches.length, 0);
  });
});

describe('deriveMonogramLetters', () => {
  it('handles common Belgian company names', () => {
    assert.equal(deriveMonogramLetters('Brantano'), 'BR');
    assert.equal(deriveMonogramLetters('Gavan Group'), 'GA');
    assert.equal(deriveMonogramLetters('TIN Construct'), 'TC');
    assert.equal(deriveMonogramLetters('Casteels Construct BV'), 'CC');
    assert.equal(deriveMonogramLetters('De Kleine Bakkerij'), 'KB');
    assert.equal(deriveMonogramLetters('HubSpot'), 'HS');
    assert.equal(deriveMonogramLetters('Fenro BV'), 'FE');
    assert.equal(deriveMonogramLetters('3M'), '3M');
  });
});

describe('normalizeWebsite', () => {
  it('reduces input to the homepage', () => {
    assert.equal(normalizeWebsite('brantano.be'), 'https://brantano.be/');
    assert.equal(normalizeWebsite(' https://WWW.Brantano.be/nl/schoenen?utm=x '), 'https://www.brantano.be/');
    assert.throws(() => normalizeWebsite('not a site'));
  });
});

void WHITE;
