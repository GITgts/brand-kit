<script setup lang="ts">
import { computed, useId } from 'vue';
import { normalizeHex } from '@wisemen/brand-kit';

const props = defineProps<{
  title: string;
  description: string;
  hex: string | null;
  swatches: { hex: string; label: string }[];
}>();
const emit = defineEmits<{ 'update:hex': [hex: string] }>();

const name = useId();
const current = computed(() => props.hex?.toUpperCase() ?? null);

function onCustom(event: Event) {
  const hex = normalizeHex((event.target as HTMLInputElement).value);
  if (hex) emit('update:hex', hex);
}
</script>

<template>
  <div class="role">
    <span class="role__chip" :style="{ background: current ?? 'transparent' }" :class="{ 'role__chip--empty': !current }" aria-hidden="true" />
    <div class="role__text">
      <p class="role__title">
        {{ title }} <code v-if="current">{{ current }}</code>
      </p>
      <p class="role__desc">{{ description }}</p>
    </div>

    <fieldset class="role__swatches">
      <legend class="sr-only">{{ title }} kiezen</legend>
      <label v-for="s in swatches" :key="s.hex" class="swatch" :title="`${s.hex} · ${s.label}`">
        <input
          type="radio"
          class="sr-only"
          :name="name"
          :value="s.hex"
          :checked="s.hex === current"
          @change="emit('update:hex', s.hex)"
        />
        <span class="swatch__dot" :style="{ background: s.hex }" />
        <span class="sr-only">{{ s.hex }}, {{ s.label }}</span>
      </label>
      <label class="swatch swatch--custom" title="Eigen kleur kiezen">
        <input type="color" class="sr-only" :value="current ?? '#4F46E5'" @change="onCustom" />
        <span class="swatch__dot" aria-hidden="true">
          <svg viewBox="0 0 16 16" width="12" height="12"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg>
        </span>
        <span class="sr-only">Eigen kleur kiezen</span>
      </label>
    </fieldset>
  </div>
</template>

<style scoped>
.role {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 16px;
  padding: 16px 20px;
}
.role + .role {
  border-top: 1px solid var(--bx-border);
}
.role__chip {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  box-shadow: inset 0 0 0 1px rgb(17 24 39 / 0.1);
}
.role__chip--empty {
  background: repeating-linear-gradient(45deg, var(--bx-border) 0 4px, transparent 4px 8px) !important;
}
.role__title {
  margin: 0;
  font-weight: 600;
  color: var(--bx-text);
}
.role__title code {
  margin-left: 6px;
  font: 500 0.8125rem/1 ui-monospace, 'SF Mono', Menlo, monospace;
  color: var(--bx-muted);
}
.role__desc {
  margin: 2px 0 0;
  font-size: 0.875rem;
  color: var(--bx-muted);
}
.role__swatches {
  display: flex;
  gap: 6px;
  margin: 0;
  padding: 0;
  border: 0;
}
.swatch {
  position: relative;
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 9px;
  cursor: pointer;
}
.swatch__dot {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  box-shadow: inset 0 0 0 1px rgb(17 24 39 / 0.12);
  transition: transform 120ms ease;
}
.swatch:hover .swatch__dot {
  transform: scale(1.08);
}
.swatch:has(input:checked) {
  box-shadow: 0 0 0 2px var(--bx-text);
}
.swatch:has(input:focus-visible) {
  outline: 2px solid var(--bx-indigo);
  outline-offset: 2px;
}
.swatch--custom .swatch__dot {
  color: var(--bx-muted);
  background: var(--bx-canvas);
}
@media (max-width: 560px) {
  .role {
    grid-template-columns: auto 1fr;
  }
  .role__swatches {
    grid-column: 1 / -1;
  }
}
/* Crispy likely ships its own; kept local so the component works standalone. */
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
@media (prefers-reduced-motion: reduce) {
  .swatch__dot {
    transition: none;
  }
}
</style>
