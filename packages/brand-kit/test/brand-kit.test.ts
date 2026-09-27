import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BrandClientError,
  applyAnalysis,
  createBrandClient,
  deriveMonogramLetters,
  emptyBrandStep,
  ensureReadableOn,
  monogramColors,
  parseCssColor,
  slugifyCompanyName,
  toHex,
  type BrandExtractionResult,
} from '../src/index';

const RESULT = {
  domain: 'brantano.be',
  finalUrl: 'https://www.brantano.be/',
  companyName: 'Brantano',
  analyzedAt: '2026-09-25T18:28:00.000Z',
  palette: { primary: '#C8102E', accent: '#1F2937', swatches: [], primarySurface: null },
  icon: {
    recommendation: 'monogram',
    reason: '…',
    monogram: { letters: 'BR', svg: '<svg/>', background: '#C8102E', foreground: '#FFFFFF' },
    logoSquarePng: null,
    logoPng: null,
    logoSourceUrl: null,
  },
  diagnostics: { decidedBy: 'vision', candidates: [], assessment: [], colorClusters: [], warnings: [], timingsMs: {} },
} satisfies BrandExtractionResult;

function fakeFetch(status: number, body: unknown, seen: { url?: string; init?: RequestInit } = {}): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    seen.url = url;
    seen.init = init;
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
}

describe('createBrandClient', () => {
  it('posts to the base URL with auth headers', async () => {
    const seen: { url?: string; init?: RequestInit } = {};
    const client = createBrandClient({
      baseUrl: 'https://brand.test/v1/brand',
      headers: async () => ({ authorization: 'Bearer k_test' }),
      fetch: fakeFetch(200, RESULT, seen),
    });
    const r = await client.extract({ website: 'brantano.be' });
    assert.equal(r.palette.primary, '#C8102E');
    assert.equal(seen.url, 'https://brand.test/v1/brand/extract');
    assert.equal((seen.init!.headers as Record<string, string>).authorization, 'Bearer k_test');
  });

  it('maps HTTP errors to typed kinds with the server message', async () => {
    const cases: [number, string][] = [[422, 'invalid-website'], [504, 'timeout'], [429, 'rate-limited'], [401, 'unauthorized'], [500, 'server']];
    for (const [status, kind] of cases) {
      const client = createBrandClient({ baseUrl: '', fetch: fakeFetch(status, { message: 'Boodschap' }) });
      await assert.rejects(client.extract({ website: 'x.be' }), (e: BrandClientError) => e.kind === kind && e.message === 'Boodschap');
    }
  });

  it('reports network failures and lets caller aborts through', async () => {
    const failing = (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch;
    await assert.rejects(createBrandClient({ baseUrl: '', fetch: failing }).extract({ website: 'x.be' }), (e: BrandClientError) => e.kind === 'network');

    const ac = new AbortController();
    ac.abort();
    const aborting = (async (_u: string, init: RequestInit) => { init.signal?.throwIfAborted(); return new Response('{}'); }) as unknown as typeof fetch;
    await assert.rejects(createBrandClient({ baseUrl: '', fetch: aborting }).extract({ website: 'x.be' }, ac.signal), (e: Error) => e.name === 'AbortError');
  });
});

describe('shared helpers', () => {
  it('colour + letters + wizard stay consistent', () => {
    assert.equal(toHex(ensureReadableOn(parseCssColor('#C8102E')!).foreground), '#FFFFFF');
    assert.equal(deriveMonogramLetters('Gavan Group'), 'GA');
    assert.equal(monogramColors('br', '#FFD500').foreground, '#0B0B0F');
    assert.equal(slugifyCompanyName('Brantano BV'), 'brantano');

    const step = applyAnalysis(emptyBrandStep('', { fallbackColor: '#0F766E' }), { ...RESULT, palette: { ...RESULT.palette, primary: null } }, { fallbackColor: '#0F766E' });
    assert.equal(step.primary, '#0F766E');
    assert.equal(step.monogramLetters, 'BR');
  });
});
