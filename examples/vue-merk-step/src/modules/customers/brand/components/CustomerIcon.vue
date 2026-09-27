<script setup lang="ts">
import { computed } from 'vue';
import type { ResolvedIcon } from '@wisemen/brand-kit';

/**
 * The one way a customer icon is drawn anywhere in WiseOS. The monogram is
 * rendered as HTML so it uses the app's own brand font; the stored asset is the
 * outline SVG from the API, which looks the same.
 */
const props = withDefaults(defineProps<{ icon: ResolvedIcon; size?: number; radius?: number; label?: string }>(), {
  size: 40,
  radius: undefined,
  label: undefined,
});

const style = computed(() => ({
  width: `${props.size}px`,
  height: `${props.size}px`,
  borderRadius: `${props.radius ?? Math.round(props.size * 0.22)}px`,
  ...(props.icon.kind === 'monogram'
    ? {
        background: props.icon.background,
        color: props.icon.foreground,
        fontSize: `${props.size * (props.icon.letters.length > 2 ? 0.3 : props.icon.letters.length === 2 ? 0.4 : 0.5)}px`,
      }
    : { background: props.icon.background ?? '#fff' }),
}));
</script>

<template>
  <span class="customer-icon" :style="style" role="img" :aria-label="label ?? (icon.kind === 'monogram' ? icon.letters : 'Klanticoon')">
    <template v-if="icon.kind === 'monogram'">{{ icon.letters }}</template>
    <img v-else :src="icon.src" alt="" draggable="false" />
  </span>
</template>

<style scoped>
.customer-icon {
  display: inline-grid;
  place-items: center;
  flex: none;
  overflow: hidden;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1;
  box-shadow: inset 0 0 0 1px rgb(17 24 39 / 0.08);
  user-select: none;
}
.customer-icon img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
</style>
