<script setup lang="ts">
import { computed } from 'vue';
import type { ResolvedIcon } from '@wisemen/brand-kit';
import { slugifyCompanyName } from '@wisemen/brand-kit';
import CustomerIcon from './CustomerIcon.vue';

/**
 * Non-interactive preview of the customer's workspace on first visit.
 * Customer colour: logo + welcome panel. WiseOS indigo: actions + focus.
 */
const props = defineProps<{
  companyName: string;
  icon: ResolvedIcon;
  primary: string;
  theme: 'light' | 'dark';
}>();

const slug = computed(() => slugifyCompanyName(props.companyName));
const nav = [
  { label: 'Vandaag', d: 'M3 13h10M5 13V8m3 5V5m3 8v-3' },
  { label: 'Mijn collega', d: 'M8 2l1.4 3.6L13 7l-3.6 1.4L8 12 6.6 8.4 3 7l3.6-1.4z' },
  { label: 'Gesprekken', d: 'M3 4h7v5H6l-3 2zm8 2h2v5l-2-1.5H8V11' },
  { label: 'Bedrijfskennis', d: 'M3 3h4a1 1 0 0 1 1 1v9a1 1 0 0 0-1-1H3zm10 0H9a1 1 0 0 0-1 1v9a1 1 0 0 1 1-1h4z' },
  { label: 'Team', d: 'M6 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm-3 6c0-2 1.3-3 3-3s3 1 3 3m1.5-6a1.8 1.8 0 1 0 0-3.6M11 10c1.3.2 2.2 1.2 2.2 3' },
];
</script>

<template>
  <div class="preview" :data-theme="theme" :style="{ '--brand': primary }" aria-hidden="true" inert>
    <div class="preview__chrome">
      <span class="preview__dots"><i /><i /><i /></span>
      <span class="preview__url">
        <svg viewBox="0 0 16 16" width="12" height="12"><path d="M5 7V5a3 3 0 0 1 6 0v2M4 7h8v6H4z" fill="none" stroke="currentColor" stroke-width="1.4" /></svg>
        {{ slug }}.wiseos.be
      </span>
    </div>

    <div class="preview__app">
      <aside class="preview__side">
        <div class="preview__tenant">
          <CustomerIcon :icon="icon" :size="36" :label="companyName" />
          <div>
            <strong>{{ companyName }}</strong>
            <small>WiseOS</small>
          </div>
        </div>
        <ul>
          <li v-for="(item, i) in nav" :key="item.label" :class="{ active: i === 0 }">
            <svg viewBox="0 0 16 16" width="16" height="16"><path :d="item.d" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round" /></svg>
            {{ item.label }}
          </li>
        </ul>
      </aside>

      <main class="preview__main">
        <section class="welcome">
          <p class="welcome__kicker">WiseOS voor {{ companyName }}</p>
          <h2>Welkom</h2>
          <p>
            Zo zou je een nieuwe digitale collega {{ companyName }} leren kennen. WiseOS stelt steeds één vraag. Je kunt
            op elk moment stoppen en later verdergaan.
          </p>
          <div class="welcome__actions">
            <span class="btn btn--primary">Kennismaking starten</span>
            <span class="btn">Later</span>
          </div>
        </section>
        <div class="tiles">
          <section><h3>Dit weet WiseOS al</h3><p>Nog niets. Het eerste gesprek vult dit aan.</p></section>
          <section><h3>Je team</h3><p>Collega's volgen na de kennismaking.</p></section>
        </div>
      </main>
    </div>
  </div>
</template>

<style scoped>
.preview {
  --p-bg: #ffffff;
  --p-canvas: #f8f9fb;
  --p-text: #111827;
  --p-muted: #6b7280;
  --p-border: #e5e7eb;
  --p-active: #f1f2f6;
  --p-card: #ffffff;
  overflow: hidden;
  border: 1px solid var(--p-border);
  border-radius: 14px;
  background: var(--p-bg);
  color: var(--p-text);
  box-shadow: 0 1px 2px rgb(17 24 39 / 0.04), 0 12px 32px -12px rgb(17 24 39 / 0.12);
  font-size: 13px;
  user-select: none;
  transition: background-color 200ms ease, color 200ms ease;
}
.preview[data-theme='dark'] {
  --p-bg: #111318;
  --p-canvas: #171a21;
  --p-text: #f3f4f6;
  --p-muted: #9ca3af;
  --p-border: #2a2e38;
  --p-active: #22262f;
  --p-card: #1b1f27;
}
.preview__chrome {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--p-border);
}
.preview__dots {
  display: flex;
  gap: 6px;
}
.preview__dots i {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--p-border);
}
.preview__url {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 0 auto;
  padding: 4px 12px;
  border: 1px solid var(--p-border);
  border-radius: 8px;
  color: var(--p-muted);
  font: 12px/1.4 ui-monospace, 'SF Mono', Menlo, monospace;
  transform: translateX(-24px);
}
.preview__app {
  display: grid;
  grid-template-columns: 200px 1fr;
  min-height: 460px;
}
.preview__side {
  padding: 16px 12px;
}
.preview__tenant {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 8px 16px;
}
.preview__tenant strong {
  display: block;
  font-size: 14px;
}
.preview__tenant small {
  color: var(--p-muted);
}
.preview__side ul {
  margin: 0;
  padding: 0;
  list-style: none;
}
.preview__side li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  color: var(--p-muted);
}
.preview__side li.active {
  background: var(--p-active);
  color: var(--p-text);
  font-weight: 500;
}
.preview__main {
  display: grid;
  align-content: start;
  gap: 16px;
  padding: 20px;
  border-left: 1px solid var(--p-border);
  background: var(--p-canvas);
}
.welcome {
  padding: 28px;
  border: 1px solid var(--p-border);
  border-radius: 12px;
  background:
    radial-gradient(120% 140% at 100% 0%, color-mix(in oklch, var(--brand) 26%, transparent) 0%, transparent 55%),
    var(--p-card);
  transition: background 200ms ease;
}
.welcome__kicker {
  margin: 0;
  color: var(--p-muted);
}
.welcome h2 {
  margin: 10px 0 12px;
  font-size: 28px;
  letter-spacing: -0.02em;
}
.welcome p:not(.welcome__kicker) {
  max-width: 54ch;
  margin: 0;
  color: var(--p-muted);
  line-height: 1.6;
}
.welcome__actions {
  display: flex;
  gap: 8px;
  margin-top: 20px;
}
.btn {
  padding: 8px 14px;
  border: 1px solid var(--p-border);
  border-radius: 8px;
  background: var(--p-card);
  font-weight: 500;
}
.btn--primary {
  border-color: transparent;
  background: var(--bx-indigo, #4f46e5);
  color: #fff;
}
.tiles {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.tiles section {
  padding: 16px;
  border: 1px solid var(--p-border);
  border-radius: 12px;
  background: var(--p-card);
}
.tiles h3 {
  margin: 0 0 6px;
  font-size: 13px;
}
.tiles p {
  margin: 0;
  color: var(--p-muted);
}
@media (max-width: 900px) {
  .preview__app {
    grid-template-columns: 1fr;
  }
  .preview__side {
    padding-bottom: 0;
  }
  .preview__side ul {
    display: none;
  }
  .preview__main {
    border-left: 0;
    border-top: 1px solid var(--p-border);
  }
}
@media (prefers-reduced-motion: reduce) {
  .preview,
  .welcome {
    transition: none;
  }
}
</style>
