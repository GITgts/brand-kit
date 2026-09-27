# Frontend

## Vue 3 (default)

The reference implementation is `examples/vue-merk-step` in the brand-kit
repo. Copy `src/modules/customers/brand/{components,composables}` into the
app's feature folder, then make these changes:

| In the example | Change to |
|---|---|
| `createBrandClient({ baseUrl: '/api/brand' })` default prop | The app's API base plus auth headers from its HTTP layer. Pass it as the `api` prop from the page. |
| `--bx-*` CSS variables in `MerkStep.vue` | Map them to the design-system tokens (Crispy: `--crispy-color-*`). Don't hard-code hex values. |
| Plain `<button>`, segmented control, inputs | The design-system components, if they exist. Keep the native radio inputs for the icon and swatch groups. They provide keyboard and screen-reader support. |
| `WorkspacePreview.vue` | The app's own "first screen", or drop it if the product has no tenant space. The preview must show the icon and the primary colour where the product really uses them. |
| Fallback colour | The product's action colour: `emptyBrandStep(letters, { fallbackColor })` and `applyAnalysis(v, r, { fallbackColor })`. |
| Dutch copy | Keep nl-BE if the app is Dutch. Otherwise move the strings to the app's i18n. `icon.reason` comes from the service in Dutch. |

Wire it into the wizard with `v-model`, so the step value lands in the
draft that the wizard already persists:

```vue
<MerkStep v-model="draft.brand" :website="draft.company.website"
          :company-name="draft.company.name" :api="brandClient"
          @previous="goTo(1)" @next="onBrandDone" />
```

`@next` delivers the `BrandStepResult` that the backend stores (see
backend-proxy.md).

## Other frameworks

Rebuild only the view. The logic is framework-free in
`@wisemen/brand-kit`:

- `emptyBrandStep`, `applyAnalysis`: the initial state, and state after an analysis
- `resolveIcon`, `monogramColors`: what to render as the icon (readable colours guaranteed)
- `swatchesFor`, `normalizeHex`: the colour pickers
- `createBrandClient`: calls with abort support and typed errors

## Behaviour that must survive the adaptation

- Analyse automatically on entering the step when the draft has no analysis
  yet. Never re-analyse a restored draft.
- Show progress, and allow the user to stop.
- On any failure, keep everything usable (fallback colour, monogram, upload).
- The monogram preview is HTML (it uses the app font). The stored asset
  comes from `/brand/monogram` on continue.
- Validate uploads client-side: SVG or PNG, square, at least 256 px, at
  most 2 MB. Show them only via `<img>`.
- The customer colour touches the icon and the welcome/brand surfaces only.
  Actions and focus keep the product colour.
