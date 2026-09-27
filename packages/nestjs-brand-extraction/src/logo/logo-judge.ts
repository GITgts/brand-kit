import Anthropic from '@anthropic-ai/sdk';
import { Inject, Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';
import { z } from 'zod';
import { BRAND_EXTRACTION_CONFIG, BrandExtractionConfig } from '../brand-extraction.config';
import { LogoAssessment, LogoCandidate } from '../brand-extraction.types';

/**
 * Asks a vision model to judge the logo candidates. The model decides; it does
 * not draw. Everything it returns is validated, and if the API is missing,
 * slow or returns garbage we fall back to deterministic heuristics — the
 * wizard must never block on this step.
 */

const SYSTEM_PROMPT = `You review logo candidates scraped from a company's website for a B2B software onboarding flow.
The goal is a uniform square customer icon (shown at 32–64 px in lists, sidebars and avatars).

For each candidate decide:
- isCompanyLogo: is this the logo of THIS company (not a partner, certification, payment method, social network, client, product photo, banner or generic icon)?
- kind: "symbol" (standalone mark/icon), "wordmark" (only text), "combination" (symbol + text), "emblem" (text inside a shape/badge), or "not_a_logo".
- legibleInSquare48: would it still be recognisable if fitted inside a 48×48 px square with padding? Long wordmarks and combination marks are usually NOT.
- quality: "good", "acceptable" or "poor" (blurry, cropped, compression artefacts, cut off by the page, wrong colours, overlay on top).
- issues: short machine-friendly notes, e.g. "blurry", "cropped", "text-too-small", "white-logo", "tagline-included", "partner-logo".

Then decide overall:
- bestLogoId: the candidate that is the company's primary logo in its best available quality (prefer vector/sharp, full logo, correct colours). null if none is the company logo.
- bestSquareId: the candidate that works best inside a square at small sizes: a clean symbol, an app icon, or a compact emblem of THIS company. Candidates with origin "symbol-crop" are automatic crops of a combination mark; only choose one if it is a meaningful, complete brand symbol (not a single letter of a wordmark, not a cut-off fragment). null if nothing is legible at 48 px.
- recommendation: "logo" only if bestSquareId is legible and good at 48 px; otherwise "monogram" (the product then renders the company initials on the brand colour, which is always consistent).
- reason: one short sentence in Dutch (Flemish business tone) explaining the recommendation to the account manager, e.g. "Het logo is een lang woordmerk en wordt onleesbaar in een klein vierkant."

Be conservative: a consistent monogram is better than an illegible or wrong logo.`;

const PerCandidate = z.object({
  id: z.string(),
  isCompanyLogo: z.boolean(),
  kind: z.enum(['symbol', 'wordmark', 'combination', 'emblem', 'not_a_logo']),
  legibleInSquare48: z.boolean(),
  quality: z.enum(['good', 'acceptable', 'poor']),
  issues: z.array(z.string()).max(8).default([]),
});

const Assessment = z.object({
  candidates: z.array(PerCandidate),
  bestLogoId: z.string().nullable(),
  bestSquareId: z.string().nullable(),
  recommendation: z.enum(['logo', 'monogram']),
  reason: z.string().max(400),
});

const TOOL: Anthropic.Tool = {
  name: 'report_logo_assessment',
  description: 'Report the structured assessment of the logo candidates.',
  input_schema: {
    type: 'object',
    properties: {
      candidates: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            isCompanyLogo: { type: 'boolean' },
            kind: { type: 'string', enum: ['symbol', 'wordmark', 'combination', 'emblem', 'not_a_logo'] },
            legibleInSquare48: { type: 'boolean' },
            quality: { type: 'string', enum: ['good', 'acceptable', 'poor'] },
            issues: { type: 'array', items: { type: 'string' } },
          },
          required: ['id', 'isCompanyLogo', 'kind', 'legibleInSquare48', 'quality', 'issues'],
        },
      },
      bestLogoId: { type: ['string', 'null'] },
      bestSquareId: { type: ['string', 'null'] },
      recommendation: { type: 'string', enum: ['logo', 'monogram'] },
      reason: { type: 'string' },
    },
    required: ['candidates', 'bestLogoId', 'bestSquareId', 'recommendation', 'reason'],
  },
};

@Injectable()
export class LogoJudge {
  private readonly logger = new Logger(LogoJudge.name);
  private readonly client: Anthropic | null;

  constructor(@Inject(BRAND_EXTRACTION_CONFIG) private readonly config: BrandExtractionConfig) {
    this.client = config.anthropicApiKey
      ? new Anthropic({ apiKey: config.anthropicApiKey, timeout: 25_000, maxRetries: 2 })
      : null;
  }

  async assess(candidates: LogoCandidate[], ctx: { companyName: string; domain: string }): Promise<LogoAssessment> {
    if (candidates.length === 0) {
      return {
        bestLogoId: null,
        bestSquareId: null,
        recommendation: 'monogram',
        reason: 'Er werd geen logo gevonden op de website.',
        perCandidate: [],
        decidedBy: 'heuristic',
      };
    }
    if (!this.client) return heuristicAssessment(candidates);

    try {
      const content: Anthropic.ContentBlockParam[] = [
        { type: 'text', text: `Company: ${ctx.companyName}\nWebsite: ${ctx.domain}\n\nCandidates follow. Each image is shown on a neutral backdrop; the backdrop is not part of the logo.` },
      ];
      for (const c of candidates) {
        const { image, backdrop } = await presentForModel(c);
        content.push({
          type: 'text',
          text:
            `Candidate ${c.id} — origin: ${c.origin}${c.derivedFrom ? ` (crop of ${c.derivedFrom})` : ''}; ` +
            `${c.width}×${c.height}px; transparent: ${c.hasTransparency ? 'yes' : 'no'}; ` +
            `own background: ${c.backgroundHex ?? 'none'}; shown on ${backdrop}.`,
        });
        content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: image.toString('base64') } });
      }

      const res = await this.client.messages.create({
        model: this.config.visionModel,
        max_tokens: 1500,
        system: SYSTEM_PROMPT,
        tools: [TOOL],
        tool_choice: { type: 'tool', name: TOOL.name },
        messages: [{ role: 'user', content }],
      });

      const toolUse = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
      const parsed = Assessment.safeParse(toolUse?.input);
      if (!parsed.success) throw new Error(`Invalid assessment: ${parsed.error.message}`);
      return sanitize(parsed.data, candidates);
    } catch (err) {
      this.logger.warn(`Vision check failed, using heuristics: ${(err as Error).message}`);
      return heuristicAssessment(candidates);
    }
  }
}

/** Keeps the model honest: ids must exist, "logo" requires a usable square candidate. */
function sanitize(a: z.infer<typeof Assessment>, candidates: LogoCandidate[]): LogoAssessment {
  const ids = new Set(candidates.map((c) => c.id));
  const bestLogoId = a.bestLogoId && ids.has(a.bestLogoId) ? a.bestLogoId : null;
  let bestSquareId = a.bestSquareId && ids.has(a.bestSquareId) ? a.bestSquareId : null;

  const sq = a.candidates.find((c) => c.id === bestSquareId);
  if (sq && (!sq.isCompanyLogo || !sq.legibleInSquare48 || sq.quality === 'poor')) bestSquareId = null;

  const recommendation = a.recommendation === 'logo' && bestSquareId ? 'logo' : 'monogram';
  return {
    bestLogoId,
    bestSquareId,
    recommendation,
    reason:
      recommendation === a.recommendation
        ? a.reason
        : 'Geen logo is scherp en leesbaar genoeg in een klein vierkant; het vaste WiseOS-icoon is consistenter.',
    perCandidate: a.candidates.filter((c) => ids.has(c.id)),
    decidedBy: 'vision',
  };
}

/**
 * Fallback without a model: trust the DOM ranking for "the logo", and only
 * recommend using it in a square if it is roughly square and sharp enough.
 */
export function heuristicAssessment(candidates: LogoCandidate[]): LogoAssessment {
  const full = candidates.filter((c) => c.origin !== 'symbol-crop');
  const ranked = [...full].sort((a, b) => b.priorScore - a.priorScore);
  const best = ranked[0] ?? null;

  const squareish = candidates
    .filter((c) => c.aspect >= 0.75 && c.aspect <= 1.33 && Math.min(c.width, c.height) >= 96)
    // A symbol crop is never trusted without a vision check.
    .filter((c) => c.origin !== 'symbol-crop' && c.origin !== 'og-image')
    .sort((a, b) => b.priorScore - a.priorScore)[0];

  return {
    bestLogoId: best?.id ?? null,
    bestSquareId: squareish?.id ?? null,
    recommendation: squareish ? 'logo' : 'monogram',
    reason: squareish
      ? 'De website heeft een vierkant merkicoon dat goed leesbaar blijft.'
      : 'Het logo is niet vierkant; het vaste WiseOS-icoon blijft leesbaar in kleine formaten.',
    perCandidate: [],
    decidedBy: 'heuristic',
  };
}

/** Flattens onto a backdrop the model can see the logo against; caps at 512 px. */
async function presentForModel(c: LogoCandidate): Promise<{ image: Buffer; backdrop: string }> {
  const backdrop = c.isLightOnTransparent ? '#1F2937' : '#F3F4F6';
  const image = await sharp(c.png)
    .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
    .extend({ top: 16, bottom: 16, left: 16, right: 16, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .flatten({ background: backdrop })
    .png()
    .toBuffer();
  return { image, backdrop: c.isLightOnTransparent ? 'dark grey' : 'light grey' };
}
