import type { BrandExtractionResult } from './contract';
import { ensureReadableOn, parseCssColor, toHex } from './color';

/**
 * Fallback brand colour when a site yields none. Apps pass their own product
 * colour (WiseOS uses its indigo) via the `fallbackColor` options below.
 */
export const DEFAULT_FALLBACK_COLOR = '#4F46E5';

export interface WizardOptions {
  fallbackColor?: string;
}

export type IconChoice = 'monogram' | 'logo' | 'upload';

/** Everything step 2 persists in the wizard draft (v-model). */
export interface BrandStepValue {
  analysis: BrandExtractionResult | null;
  iconChoice: IconChoice;
  monogramLetters: string;
  primary: string;
  accent: string | null;
  upload: { dataUrl: string; fileName: string } | null;
  /** True once the user changed something, so a re-analysis doesn't silently undo it. */
  touched: boolean;
}

/** What the wizard stores on the customer when the step is completed. */
export interface BrandStepResult {
  primary: string;
  accent: string | null;
  icon: { kind: IconChoice; mimeType: 'image/svg+xml' | 'image/png'; dataUrl: string; background: string };
}

export type ResolvedIcon =
  | { kind: 'monogram'; letters: string; background: string; foreground: string }
  | { kind: 'image'; src: string; background: string | null };

export function emptyBrandStep(letters = '', opts: WizardOptions = {}): BrandStepValue {
  return {
    analysis: null,
    iconChoice: 'monogram',
    monogramLetters: letters,
    primary: opts.fallbackColor ?? DEFAULT_FALLBACK_COLOR,
    accent: null,
    upload: null,
    touched: false,
  };
}

/**
 * Applies a (new) analysis to the step. Colours and the recommended icon are
 * reset to the analysis defaults; a file the user uploaded themselves is kept.
 */
export function applyAnalysis(
  value: BrandStepValue,
  analysis: BrandExtractionResult,
  opts: WizardOptions = {},
): BrandStepValue {
  const keepUpload = value.iconChoice === 'upload' && value.upload !== null;
  const recommended: IconChoice =
    analysis.icon.recommendation === 'logo' && analysis.icon.logoSquarePng ? 'logo' : 'monogram';
  return {
    ...value,
    analysis,
    primary: analysis.palette.primary ?? opts.fallbackColor ?? DEFAULT_FALLBACK_COLOR,
    accent: analysis.palette.accent,
    monogramLetters: analysis.icon.monogram.letters,
    iconChoice: keepUpload ? 'upload' : recommended,
    touched: keepUpload,
  };
}

export function resolveIcon(value: BrandStepValue): ResolvedIcon {
  const logo = value.analysis?.icon.logoSquarePng;
  if (value.iconChoice === 'logo' && logo) return { kind: 'image', src: logo, background: null };
  if (value.iconChoice === 'upload' && value.upload) return { kind: 'image', src: value.upload.dataUrl, background: null };
  return monogramColors(value.monogramLetters || '?', value.primary);
}

export function monogramColors(letters: string, background: string): Extract<ResolvedIcon, { kind: 'monogram' }> {
  const parsed = parseCssColor(background) ?? parseCssColor(DEFAULT_FALLBACK_COLOR)!;
  const readable = ensureReadableOn(parsed);
  return {
    kind: 'monogram',
    letters: letters.toUpperCase().slice(0, 3),
    background: toHex(readable.background),
    foreground: toHex(readable.foreground),
  };
}

/** Swatches offered for a colour role: analysis swatches plus the current (possibly custom) value. */
export function swatchesFor(value: BrandStepValue, current: string | null): { hex: string; label: string }[] {
  const list = (value.analysis?.palette.swatches ?? []).map((s) => ({ hex: s.hex.toUpperCase(), label: s.explanation }));
  if (current && !list.some((s) => s.hex === current.toUpperCase())) list.push({ hex: current.toUpperCase(), label: 'Eigen kleur' });
  return list.slice(0, 6);
}

export function normalizeHex(input: string): string | null {
  const c = parseCssColor(input.startsWith('#') ? input : `#${input}`);
  return c ? toHex(c) : null;
}

/** "Brantano BV" → "brantano", e.g. for a tenant subdomain preview. */
export function slugifyCompanyName(companyName: string): string {
  return (
    companyName
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\b(bv|nv|bvba|srl|sa|vzw|group|groep)\b/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'klant'
  );
}
