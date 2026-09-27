import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import type { BrandClient, BrandExtractionResult } from '@wisemen/brand-kit';
import { BrandClientError } from '@wisemen/brand-kit';
import {
  BrandStepValue,
  applyAnalysis,
  emptyBrandStep,
  monogramColors,
  resolveIcon,
  slugifyCompanyName,
} from '@wisemen/brand-kit';
import MerkStep from '../src/modules/customers/brand/components/MerkStep.vue';
import { svgAspect } from '../src/modules/customers/brand/composables/useIconUpload';

const RESULT: BrandExtractionResult = {
  domain: 'brantano.be',
  finalUrl: 'https://www.brantano.be/',
  companyName: 'Brantano',
  analyzedAt: '2026-09-25T18:28:00.000Z',
  palette: {
    primary: '#C8102E',
    accent: '#1F2937',
    swatches: [
      { hex: '#C8102E', explanation: 'knoppen + logo' },
      { hex: '#1F2937', explanation: 'header + links' },
      { hex: '#E8DFD0', explanation: 'homepage' },
      { hex: '#8A8F98', explanation: 'homepage' },
    ],
    primarySurface: { hex: '#C8102E', onColor: '#FFFFFF', adjusted: false, contrast: 5.89 },
  },
  icon: {
    recommendation: 'monogram',
    reason: 'Het logo is een lang woordmerk en wordt onleesbaar in een klein vierkant.',
    monogram: { letters: 'BR', svg: '<svg/>', background: '#C8102E', foreground: '#FFFFFF' },
    logoSquarePng: 'data:image/png;base64,AAAA',
    logoPng: 'data:image/png;base64,AAAA',
    logoSourceUrl: 'https://www.brantano.be/logo.svg',
  },
  diagnostics: { decidedBy: 'vision', candidates: [], assessment: [], colorClusters: [], warnings: [], timingsMs: {} },
};

function fakeApi(overrides: Partial<BrandClient> = {}): BrandClient {
  return {
    extract: vi.fn(async () => RESULT),
    monogram: vi.fn(async ({ letters, background }) => ({
      svg: `<svg data-letters="${letters}" data-bg="${background}"/>`,
      background,
      foreground: '#FFFFFF',
      adjusted: false,
    })),
    ...overrides,
  };
}

/** Hosts MerkStep with a real v-model, like the wizard does. */
function mountStep(api: BrandClient, initial: BrandStepValue = emptyBrandStep()) {
  const model = ref(initial);
  const onNext = vi.fn();
  const Host = defineComponent({
    setup: () => () =>
      h(MerkStep, {
        website: 'brantano.be',
        companyName: 'Brantano',
        api,
        modelValue: model.value,
        'onUpdate:modelValue': (v: BrandStepValue) => (model.value = v),
        onNext,
      }),
  });
  return { wrapper: mount(Host), model, onNext };
}

describe('brand-step logic', () => {
  it('applies analysis defaults and keeps a user upload', () => {
    const v = applyAnalysis(emptyBrandStep(), RESULT);
    expect(v.primary).toBe('#C8102E');
    expect(v.accent).toBe('#1F2937');
    expect(v.iconChoice).toBe('monogram');
    expect(v.monogramLetters).toBe('BR');

    const withUpload = { ...v, iconChoice: 'upload' as const, upload: { dataUrl: 'data:x', fileName: 'x.png' } };
    expect(applyAnalysis(withUpload, RESULT).iconChoice).toBe('upload');
  });

  it('never recommends a logo that is not there', () => {
    const noLogo = { ...RESULT, icon: { ...RESULT.icon, recommendation: 'logo' as const, logoSquarePng: null } };
    expect(applyAnalysis(emptyBrandStep(), noLogo).iconChoice).toBe('monogram');
  });

  it('keeps monogram letters readable on any colour', () => {
    expect(monogramColors('br', '#C8102E')).toMatchObject({ letters: 'BR', foreground: '#FFFFFF', background: '#C8102E' });
    expect(monogramColors('ga', '#FFD500').foreground).toBe('#0B0B0F');
    expect(monogramColors('tc', '#16A34A').background).not.toBe('#16A34A'); // darkened for AA
  });

  it('resolves the icon for each choice', () => {
    const v = applyAnalysis(emptyBrandStep(), RESULT);
    expect(resolveIcon(v).kind).toBe('monogram');
    expect(resolveIcon({ ...v, iconChoice: 'logo' })).toMatchObject({ kind: 'image', src: RESULT.icon.logoSquarePng });
  });

  it('reads SVG aspect ratios and builds slugs', () => {
    expect(svgAspect('<svg viewBox="0 0 512 512"></svg>')).toBe(1);
    expect(svgAspect('<svg width="600" height="120"></svg>')).toBe(5);
    expect(svgAspect('<div/>')).toBeNull();
    expect(slugifyCompanyName('Brantano BV')).toBe('brantano');
    expect(slugifyCompanyName('Café Ötzi & Zonen')).toBe('cafe-otzi-zonen');
  });
});

describe('MerkStep', () => {
  it('analyses on mount, shows the palette and recommended icon', async () => {
    const api = fakeApi();
    const { wrapper, model } = mountStep(api);
    await flushPromises();

    expect(api.extract).toHaveBeenCalledWith(expect.objectContaining({ website: 'brantano.be', companyName: 'Brantano' }), expect.anything());
    expect(model.value.primary).toBe('#C8102E');
    expect(wrapper.text()).toContain('brantano.be');
    expect(wrapper.text()).toContain('Aanbevolen');
    expect(wrapper.text()).toContain(RESULT.icon.reason);
    expect(wrapper.findAll('input[type="radio"][value="#C8102E"]')).toHaveLength(2); // primary + accent rows
    expect(wrapper.text()).toContain('brantano.wiseos.be');
  });

  it('does not re-analyse a restored draft', async () => {
    const api = fakeApi();
    mountStep(api, applyAnalysis(emptyBrandStep(), RESULT));
    await flushPromises();
    expect(api.extract).not.toHaveBeenCalled();
  });

  it('updates the model when the user picks colours, icon and letters', async () => {
    const { wrapper, model } = mountStep(fakeApi());
    await flushPromises();

    await wrapper.findAll('input[type="radio"][value="#1F2937"]')[0].setValue(true);
    expect(model.value.primary).toBe('#1F2937');
    expect(model.value.touched).toBe(true);

    const letters = wrapper.find('input[aria-label="Letters van het icoon"]');
    await letters.setValue('b-r!x9');
    expect(model.value.monogramLetters).toBe('BRX');

    await wrapper.find('input[name="icon"][value="logo"]').setValue(true);
    expect(model.value.iconChoice).toBe('logo');
  });

  it('finalises the monogram through the API on Volgende', async () => {
    const api = fakeApi();
    const { wrapper, onNext } = mountStep(api);
    await flushPromises();

    const next = wrapper.findAll('button').find((b) => b.text().includes('Volgende'))!;
    await next.trigger('click');
    await flushPromises();

    expect(api.monogram).toHaveBeenCalledWith({ letters: 'BR', background: '#C8102E' });
    const result = onNext.mock.calls[0][0];
    expect(result.icon.kind).toBe('monogram');
    expect(result.icon.mimeType).toBe('image/svg+xml');
    expect(decodeURIComponent(result.icon.dataUrl)).toContain('data-letters="BR"');
  });

  it('stays usable when the analysis fails', async () => {
    const api = fakeApi({
      extract: vi.fn(async () => {
        throw new BrandClientError('timeout', 'De website reageerde te traag.');
      }),
    });
    const { wrapper, model } = mountStep(api);
    await flushPromises();

    expect(wrapper.text()).toContain('De website reageerde te traag.');
    expect(wrapper.text()).toContain('Opnieuw proberen');
    expect(model.value.primary).toBe('#4F46E5');
    const next = wrapper.findAll('button').find((b) => b.text().includes('Volgende'))!;
    expect(next.attributes('disabled')).toBeUndefined();
  });
});
