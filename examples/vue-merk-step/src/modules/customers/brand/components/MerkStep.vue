<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { BrandClient, createBrandClient } from '@wisemen/brand-kit';
import {
  BrandStepResult,
  BrandStepValue,
  IconChoice,
  applyAnalysis,
  monogramColors,
  resolveIcon,
  swatchesFor,
} from '@wisemen/brand-kit';
import { useBrandExtraction } from '../composables/useBrandExtraction';
import { useIconUpload } from '../composables/useIconUpload';
import ColorRoleRow from './ColorRoleRow.vue';
import CustomerIcon from './CustomerIcon.vue';
import WorkspacePreview from './WorkspacePreview.vue';

/**
 * Step 2 · Merk of the "Nieuwe klant" wizard.
 *
 *   <MerkStep v-model="draft.brand" :website="draft.company.website"
 *             :company-name="draft.company.name" @previous="…" @next="saveBrand" />
 */
const props = withDefaults(
  defineProps<{
    website: string;
    companyName: string;
    api?: BrandClient;
  }>(),
  { api: () => createBrandClient({ baseUrl: '/api/brand' }) },
);
const model = defineModel<BrandStepValue>({ required: true });
const emit = defineEmits<{ previous: []; next: [result: BrandStepResult] }>();

const extraction = useBrandExtraction(props.api);
const upload = useIconUpload();
const fileInput = ref<HTMLInputElement | null>(null);
const theme = ref<'light' | 'dark'>('light');
const saving = ref(false);
const saveError = ref<string | null>(null);

const analysis = computed(() => model.value.analysis);
const icon = computed(() => resolveIcon(model.value));
const monogramPreview = computed(() => monogramColors(model.value.monogramLetters || '?', model.value.primary));
const hasLogo = computed(() => !!analysis.value?.icon.logoSquarePng);
const recommended = computed<IconChoice>(() =>
  analysis.value?.icon.recommendation === 'logo' && hasLogo.value ? 'logo' : 'monogram',
);
const primarySwatches = computed(() => swatchesFor(model.value, model.value.primary));
const accentSwatches = computed(() => swatchesFor(model.value, model.value.accent));
const analyzing = computed(() => extraction.status.value === 'analyzing');

const analyzedAt = computed(() =>
  analysis.value
    ? new Date(analysis.value.analyzedAt).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' })
    : null,
);

const notice = computed(() => {
  const w = analysis.value?.diagnostics.warnings ?? [];
  if (w.some((x) => x.startsWith('render-failed') || x === 'fallback-without-browser')) {
    return 'De website liet geen volledige analyse toe. Controleer het icoon en de kleuren.';
  }
  if (w.includes('no-brand-color')) return 'Geen duidelijke merkkleur gevonden. Kies er hieronder zelf een.';
  if (w.includes('no-logo-candidates')) return 'Geen logo gevonden in de sitekop. Het vierkant icoon werkt altijd.';
  return null;
});

const canContinue = computed(
  () => !!model.value.primary && (model.value.iconChoice !== 'upload' || !!model.value.upload) && !saving.value,
);

// ---------------------------------------------------------------------------

function patch(p: Partial<BrandStepValue>) {
  model.value = { ...model.value, ...p, touched: true };
}

async function runAnalysis(force = false) {
  if (!props.website) return;
  const result = await extraction.analyze(props.website, props.companyName, { force });
  if (result) model.value = applyAnalysis(model.value, result);
}

onMounted(() => {
  // A restored draft already has its analysis; don't spend a new run on it.
  if (!model.value.analysis) runAnalysis();
});
watch(
  () => props.website,
  (next, prev) => {
    if (next && next !== prev) runAnalysis();
  },
);

function selectIcon(choice: IconChoice) {
  if (choice === 'logo' && !hasLogo.value) return;
  if (choice === 'upload' && !model.value.upload) {
    fileInput.value?.click();
    return;
  }
  patch({ iconChoice: choice });
}

async function onFile(file: File | undefined | null) {
  if (!file) return;
  const ok = await upload.validate(file);
  if (ok) patch({ upload: ok, iconChoice: 'upload' });
}

function onDrop(event: DragEvent) {
  onFile(event.dataTransfer?.files?.[0]);
}

function onLetters(event: Event) {
  const value = (event.target as HTMLInputElement).value.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 3);
  patch({ monogramLetters: value.toUpperCase() });
}

async function next() {
  saving.value = true;
  saveError.value = null;
  try {
    emit('next', await finalize());
  } catch {
    saveError.value = 'Het icoon kon niet bewaard worden. Probeer opnieuw.';
  } finally {
    saving.value = false;
  }
}

/** Produces the stored asset: outline SVG for the monogram, the PNG/SVG otherwise. */
async function finalize(): Promise<BrandStepResult> {
  const v = model.value;
  const base = { primary: v.primary, accent: v.accent };
  if (v.iconChoice === 'logo' && analysis.value?.icon.logoSquarePng) {
    return { ...base, icon: { kind: 'logo', mimeType: 'image/png', dataUrl: analysis.value.icon.logoSquarePng, background: '#FFFFFF' } };
  }
  if (v.iconChoice === 'upload' && v.upload) {
    const mimeType = v.upload.dataUrl.startsWith('data:image/svg') ? 'image/svg+xml' : 'image/png';
    return { ...base, icon: { kind: 'upload', mimeType, dataUrl: v.upload.dataUrl, background: '#FFFFFF' } };
  }
  const m = await props.api.monogram({ letters: v.monogramLetters || '?', background: v.primary });
  return {
    ...base,
    icon: {
      kind: 'monogram',
      mimeType: 'image/svg+xml',
      dataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(m.svg)}`,
      background: m.background,
    },
  };
}

defineExpose({ finalize, reanalyze: () => runAnalysis(true) });
</script>

<template>
  <div class="merk">
    <section class="merk__form">
      <div class="merk__scroll">
        <!-- Analysis status -->
        <div class="analysis" :class="`analysis--${extraction.status.value}`" aria-live="polite">
          <span class="analysis__glyph" aria-hidden="true">
            <span v-if="analyzing" class="spinner" />
            <svg v-else viewBox="0 0 20 20" width="18" height="18"><path d="M3 7V4a1 1 0 0 1 1-1h3m6 0h3a1 1 0 0 1 1 1v3m0 6v3a1 1 0 0 1-1 1h-3m-6 0H4a1 1 0 0 1-1-1v-3m5.5-1.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zm2-.5 2 2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" /></svg>
          </span>
          <div class="analysis__text">
            <p class="analysis__domain">{{ analysis?.domain ?? website }}</p>
            <p v-if="analyzing">{{ extraction.phaseLabel.value }}…</p>
            <p v-else-if="extraction.status.value === 'failed'" class="analysis__error">
              {{ extraction.error.value?.message }} Kies hieronder zelf een icoon en kleur.
            </p>
            <p v-else-if="analysis">Om {{ analyzedAt }} · kleuren uit de homepage, logo uit de sitekop.</p>
            <p v-else-if="!website">Geen website ingevuld in stap 1. Kies zelf een icoon en kleur.</p>
            <p v-if="notice && !analyzing" class="analysis__notice">{{ notice }}</p>
          </div>
          <button v-if="analyzing" type="button" class="link-btn" @click="extraction.cancel()">Stoppen</button>
          <button v-else-if="website" type="button" class="link-btn" @click="runAnalysis(true)">
            <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M16 10a6 6 0 1 1-1.8-4.3M16 3v3.5h-3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
            {{ extraction.status.value === 'failed' ? 'Opnieuw proberen' : 'Opnieuw analyseren' }}
          </button>
        </div>

        <!-- Icon -->
        <fieldset class="group">
          <legend class="group__title">Klanticoon</legend>
          <div class="icons">
            <label class="option" :class="{ 'option--on': model.iconChoice === 'monogram' }">
              <input type="radio" class="sr-only" name="icon" value="monogram" :checked="model.iconChoice === 'monogram'" @change="selectIcon('monogram')" />
              <CustomerIcon :icon="monogramPreview" :size="64" :radius="14" />
              <span class="option__title">Vierkant icoon</span>
              <span v-if="recommended === 'monogram' && analysis" class="badge">Aanbevolen</span>
              <span class="option__desc">Gemaakt in de vaste WiseOS-stijl, zodat alle klanten er hetzelfde uitzien.</span>
              <span v-if="model.iconChoice === 'monogram'" class="letters">
                <span>Letters</span>
                <input
                  :value="model.monogramLetters"
                  maxlength="3"
                  autocomplete="off"
                  spellcheck="false"
                  aria-label="Letters van het icoon"
                  @input="onLetters"
                  @click.stop
                />
              </span>
            </label>

            <label class="option" :class="{ 'option--on': model.iconChoice === 'logo', 'option--off': !hasLogo }">
              <input type="radio" class="sr-only" name="icon" value="logo" :checked="model.iconChoice === 'logo'" :disabled="!hasLogo" @change="selectIcon('logo')" />
              <span v-if="hasLogo" class="option__thumb"><img :src="analysis!.icon.logoSquarePng!" alt="" /></span>
              <span v-else class="option__thumb option__thumb--empty" :class="{ shimmer: analyzing }" />
              <span class="option__title">Logo van de website</span>
              <span v-if="recommended === 'logo'" class="badge">Aanbevolen</span>
              <span class="option__desc">
                <template v-if="analyzing">Logo zoeken…</template>
                <template v-else-if="!hasLogo">Geen bruikbaar logo gevonden op de website.</template>
                <template v-else-if="recommended === 'logo'">Het merkicoon van de website, scherp genoeg voor kleine formaten.</template>
                <template v-else>Het originele logo. Een liggend logo wordt klein in een vierkant.</template>
              </span>
            </label>

            <label
              class="option option--drop"
              :class="{ 'option--on': model.iconChoice === 'upload' }"
              @dragover.prevent
              @drop.prevent="onDrop"
            >
              <input type="radio" class="sr-only" name="icon" value="upload" :checked="model.iconChoice === 'upload'" @change="selectIcon('upload')" @click="!model.upload && ($event.preventDefault(), fileInput?.click())" />
              <span v-if="model.upload" class="option__thumb"><img :src="model.upload.dataUrl" alt="" /></span>
              <span v-else class="option__thumb option__thumb--upload" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="24" height="24"><path d="M12 15V4m0 0-4 4m4-4 4 4M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" /></svg>
              </span>
              <span class="option__title">Eigen bestand</span>
              <span class="option__desc">
                <template v-if="upload.busy.value">Bestand controleren…</template>
                <template v-else-if="model.upload">{{ model.upload.fileName }}</template>
                <template v-else>SVG of PNG, vierkant, minstens 256 × 256 px. Sleep of klik.</template>
              </span>
              <button v-if="model.upload" type="button" class="link-btn link-btn--small" @click.prevent.stop="fileInput?.click()">Ander bestand</button>
            </label>
          </div>
          <input ref="fileInput" type="file" accept="image/svg+xml,image/png" hidden @change="onFile(($event.target as HTMLInputElement).files?.[0]); ($event.target as HTMLInputElement).value = ''" />
          <p v-if="upload.error.value" class="field-error" role="alert">{{ upload.error.value }}</p>
          <p v-else-if="analysis && !analyzing" class="hint">{{ analysis.icon.reason }}</p>
        </fieldset>

        <!-- Colours -->
        <div class="group">
          <h3 class="group__title">Kleuren van de website</h3>
          <div class="colors" :class="{ shimmer: analyzing && !analysis }">
            <ColorRoleRow
              title="Hoofdkleur"
              description="Uit de header en knoppen van de homepage"
              :hex="model.primary"
              :swatches="primarySwatches"
              @update:hex="patch({ primary: $event })"
            />
            <ColorRoleRow
              title="Accentkleur"
              description="Uit links en highlights"
              :hex="model.accent"
              :swatches="accentSwatches"
              @update:hex="patch({ accent: $event })"
            />
          </div>
          <p class="explainer">
            De klantkleur verschijnt in het logo, het welkomstpaneel en kleine herkenningsaccenten. Knoppen, focus en
            statussen blijven WiseOS-indigo, zodat acties en meldingen altijd leesbaar zijn.
          </p>
        </div>
      </div>

      <footer class="merk__footer">
        <button type="button" class="btn btn--ghost" @click="emit('previous')">
          <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M16 10H4m0 0 5-5m-5 5 5 5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" /></svg>
          Vorige
        </button>
        <p v-if="saveError" class="field-error" role="alert">{{ saveError }}</p>
        <button type="button" class="btn btn--primary" :disabled="!canContinue" @click="next">
          {{ saving ? 'Bewaren…' : 'Volgende' }}
          <svg v-if="!saving" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M4 10h12m0 0-5-5m5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </button>
      </footer>
    </section>

    <section class="merk__preview" aria-label="Live preview">
      <header class="preview-head">
        <div>
          <h3>Live preview</h3>
          <p>Zo ziet de admin de omgeving bij het eerste bezoek. Niet klikbaar.</p>
        </div>
        <div class="segmented" role="radiogroup" aria-label="Thema van de preview">
          <label><input v-model="theme" type="radio" class="sr-only" value="light" /><span>Licht</span></label>
          <label><input v-model="theme" type="radio" class="sr-only" value="dark" /><span>Donker</span></label>
        </div>
      </header>
      <WorkspacePreview :company-name="companyName || analysis?.companyName || 'Nieuwe klant'" :icon="icon" :primary="model.primary" :theme="theme" />
      <p class="legend">
        <span><i :style="{ background: model.primary }" />Klantkleur: logo en welkomstpaneel</span>
        <span><i class="legend__indigo" />WiseOS-indigo: acties en focus</span>
      </p>
    </section>
  </div>
</template>

<style scoped>
/* Map these to Crispy tokens; fallbacks follow the Claude Design prototype. */
.merk {
  --bx-indigo: var(--crispy-color-primary, #4f46e5);
  --bx-indigo-soft: var(--crispy-color-primary-subtle, #eef0ff);
  --bx-text: var(--crispy-color-text, #111827);
  --bx-muted: var(--crispy-color-text-muted, #6b7280);
  --bx-border: var(--crispy-color-border, #e5e7eb);
  --bx-surface: var(--crispy-color-surface, #ffffff);
  --bx-canvas: var(--crispy-color-canvas, #f9fafb);
  --bx-danger: var(--crispy-color-danger, #b42318);

  display: grid;
  grid-template-columns: minmax(360px, 640px) 1fr;
  height: 100%;
  min-height: 0;
  color: var(--bx-text);
  font-size: 0.9375rem;
  line-height: 1.5;
}

/* ---------- left: form ---------- */
.merk__form {
  display: grid;
  grid-template-rows: 1fr auto;
  min-height: 0;
  border-right: 1px solid var(--bx-border);
  background: var(--bx-surface);
}
.merk__scroll {
  display: grid;
  align-content: start;
  gap: 32px;
  padding: 24px 48px 32px;
  overflow-y: auto;
}
.merk__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 20px 48px;
  border-top: 1px solid var(--bx-border);
}
.merk__footer .field-error {
  margin: 0;
}

.analysis {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: start;
  gap: 14px;
  padding: 18px 20px;
  border: 1px solid var(--bx-border);
  border-radius: 14px;
}
.analysis--failed {
  border-color: color-mix(in oklch, var(--bx-danger) 35%, var(--bx-border));
}
.analysis__glyph {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: var(--bx-indigo-soft);
  color: var(--bx-indigo);
}
.analysis__text p {
  margin: 0;
  color: var(--bx-muted);
}
.analysis__text .analysis__domain {
  color: var(--bx-text);
  font-weight: 600;
}
.analysis__error {
  color: var(--bx-danger) !important;
}
.analysis__notice {
  margin-top: 6px !important;
  color: var(--bx-text) !important;
}

.group {
  display: grid;
  gap: 12px;
  margin: 0;
  padding: 0;
  border: 0;
  min-width: 0;
}
.group__title {
  margin: 0 0 12px;
  padding: 0;
  font-size: 1rem;
  font-weight: 500;
}
.icons {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}
.option {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  padding: 18px;
  border: 1px solid var(--bx-border);
  border-radius: 14px;
  background: var(--bx-surface);
  cursor: pointer;
  transition: border-color 120ms ease, box-shadow 120ms ease;
}
.option:hover {
  border-color: color-mix(in oklch, var(--bx-indigo) 40%, var(--bx-border));
}
.option--on {
  border-color: var(--bx-indigo);
  background: color-mix(in oklch, var(--bx-indigo-soft) 55%, var(--bx-surface));
  box-shadow: 0 0 0 3px color-mix(in oklch, var(--bx-indigo) 18%, transparent);
}
.option:has(input:focus-visible) {
  outline: 2px solid var(--bx-indigo);
  outline-offset: 2px;
}
.option--off {
  cursor: not-allowed;
  opacity: 0.6;
}
.option::after {
  content: '';
  position: absolute;
  top: 14px;
  right: 14px;
  width: 16px;
  height: 16px;
  border: 1.5px solid var(--bx-border);
  border-radius: 50%;
  background: var(--bx-surface);
}
.option--on::after {
  border: 5px solid var(--bx-indigo);
}
.option__thumb {
  display: grid;
  place-items: center;
  width: 64px;
  height: 64px;
  overflow: hidden;
  border: 1px solid var(--bx-border);
  border-radius: 14px;
  background: #fff;
}
.option__thumb img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.option__thumb--empty {
  background: var(--bx-canvas);
}
.option__thumb--upload {
  color: var(--bx-muted);
  border-style: dashed;
}
.option__title {
  margin-top: 10px;
  font-weight: 600;
}
.option__desc {
  color: var(--bx-muted);
  font-size: 0.875rem;
}
.badge {
  padding: 1px 8px;
  border-radius: 6px;
  background: var(--bx-indigo-soft);
  color: var(--bx-indigo);
  font-size: 0.8125rem;
  font-weight: 500;
}
.letters {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  color: var(--bx-muted);
  font-size: 0.8125rem;
}
.letters input {
  width: 4.5em;
  padding: 4px 8px;
  border: 1px solid var(--bx-border);
  border-radius: 8px;
  background: var(--bx-surface);
  color: var(--bx-text);
  font: 600 0.875rem/1.2 inherit;
  text-transform: uppercase;
}
.letters input:focus-visible {
  outline: 2px solid var(--bx-indigo);
  outline-offset: 1px;
}

.colors {
  border: 1px solid var(--bx-border);
  border-radius: 14px;
  background: var(--bx-surface);
}
.hint,
.explainer {
  margin: 0;
  max-width: 62ch;
  color: var(--bx-muted);
}
.field-error {
  margin: 0;
  color: var(--bx-danger);
  font-size: 0.875rem;
}

/* ---------- buttons ---------- */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  border: 1px solid transparent;
  border-radius: 10px;
  font: 600 1rem/1.2 inherit;
  cursor: pointer;
}
.btn--primary {
  background: var(--bx-indigo);
  color: #fff;
}
.btn--primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.btn--ghost {
  background: none;
  color: var(--bx-text);
}
.btn:focus-visible,
.link-btn:focus-visible {
  outline: 2px solid var(--bx-indigo);
  outline-offset: 2px;
}
.link-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border: 0;
  border-radius: 6px;
  background: none;
  color: var(--bx-text);
  font: 600 0.9375rem/1.2 inherit;
  white-space: nowrap;
  cursor: pointer;
}
.link-btn--small {
  padding: 0;
  color: var(--bx-indigo);
  font-size: 0.8125rem;
}

/* ---------- right: preview ---------- */
.merk__preview {
  display: grid;
  align-content: start;
  gap: 20px;
  padding: 32px;
  overflow-y: auto;
  background-color: var(--bx-canvas);
  background-image: radial-gradient(color-mix(in oklch, var(--bx-muted) 22%, transparent) 1px, transparent 1px);
  background-size: 20px 20px;
}
.preview-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
.preview-head h3 {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
}
.preview-head p {
  margin: 2px 0 0;
  color: var(--bx-muted);
}
.segmented {
  display: inline-flex;
  padding: 3px;
  border: 1px solid var(--bx-border);
  border-radius: 10px;
  background: var(--bx-surface);
}
.segmented span {
  display: block;
  padding: 6px 16px;
  border-radius: 7px;
  font-weight: 500;
  cursor: pointer;
}
.segmented label:has(input:checked) span {
  background: var(--bx-canvas);
  box-shadow: inset 0 0 0 1px var(--bx-border);
}
.segmented label:has(input:focus-visible) span {
  outline: 2px solid var(--bx-indigo);
}
.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 24px;
  margin: 0;
  color: var(--bx-muted);
  font-size: 0.875rem;
}
.legend span {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.legend i {
  width: 12px;
  height: 12px;
  border-radius: 3px;
}
.legend__indigo {
  background: var(--bx-indigo);
}

/* ---------- loading ---------- */
.spinner {
  width: 16px;
  height: 16px;
  border: 2px solid color-mix(in oklch, var(--bx-indigo) 25%, transparent);
  border-top-color: var(--bx-indigo);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
.shimmer {
  background-image: linear-gradient(100deg, transparent 30%, rgb(255 255 255 / 0.6) 50%, transparent 70%);
  background-size: 200% 100%;
  animation: shimmer 1.4s ease-in-out infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@keyframes shimmer {
  from {
    background-position: 150% 0;
  }
  to {
    background-position: -50% 0;
  }
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}

@media (max-width: 1100px) {
  .merk {
    grid-template-columns: 1fr;
    height: auto;
  }
  .merk__form {
    border-right: 0;
  }
  .merk__scroll,
  .merk__footer {
    padding-inline: 24px;
  }
  .merk__footer {
    position: sticky;
    bottom: 0;
    background: var(--bx-surface);
  }
}
@media (max-width: 640px) {
  .icons {
    grid-template-columns: 1fr;
  }
  .merk__preview {
    padding: 20px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .spinner,
  .shimmer {
    animation: none;
  }
  .option {
    transition: none;
  }
}
</style>
