---
name: integrate-brand-step
description: Add Wisemen brand extraction to an application repo, so that a website URL gives brand colours, a logo check and a uniform square customer icon. Use when asked to add a brand/"Merk" step, customer icons, brand colours from a website, or to "use the brand service / brand-kit" in a project. Covers the backend proxy, asset storage, the UI (Vue reference included) and tests.
---

# Integrate the brand step into an application

You are working in an **application repo**, not in the brand-kit monorepo. The
engine already exists as a deployed service. Your job is to wire it into this
app correctly. Do not re-implement extraction, colour math or icon rendering.

## Architecture you must follow

```
Browser (app UI) ──► App backend (proxy + storage) ──► brand-service /v1/brand/*
        uses @wisemen/brand-kit         uses @wisemen/brand-kit
```

- The browser **never** calls brand-service and never sees its key.
- The app backend authenticates the user, rate-limits per user, forwards the
  call with the app's own service key, and stores the chosen assets.
- Types, client, colour math and letters come from
  `@wisemen/brand-kit`. Never copy them.

The principles behind this are in the brand-kit repo:
`.specify/memory/constitution.md`. Summary: uniformity over fidelity, the
model judges but never draws, never block the user, readability guaranteed,
untrusted input stays untrusted.

## Steps

1. **Orient.** Read this repo's `AGENTS.md` / constitution / `specs/`.
   Identify:
   - the backend framework (expect NestJS)
   - the frontend (expect Vue 3)
   - the auth guard
   - the file/asset storage module
   - the design system (Crispy)
   - where the customer entity lives

2. **Spec first.** Write the spec in this repo's own format (for example
   `docs/superpowers/specs/` + `plans/`, or `specs/NNN-*/`).
   `references/spec-template.md` lists what it must cover: which screen hosts
   the step, what gets stored, and which fallback colour to use. Get the open
   questions answered before writing code.

3. **Install the kit.** Add `@wisemen/brand-kit` to the backend and frontend
   packages (via the repo's pnpm catalog if it uses one). `@wisemen/*` is
   normally exempt from `minimumReleaseAge`. After install,
   `@wisemen/skills-cli` syncs this skill into
   `.agents/skills/packages@…`, so keep the package version and the skill in
   step.

4. **Backend proxy.** Implement it exactly as in `references/backend-proxy.md`:
   - `POST /brand/extract`
   - `POST /brand/monogram`

   Use the existing auth guard, add a per-user throttle, and map errors
   1:1. Add the env vars `BRAND_SERVICE_URL` and `BRAND_SERVICE_API_KEY` to
   the env schema and to `.env.example`.

5. **Persistence.** When the customer (or brand step) is saved, convert the
   chosen `icon.dataUrl` into a stored file through the app's file module.
   Sanitise SVG uploads. Store the primary and accent hex values on the
   customer. See `references/backend-proxy.md` → "Storing the result".

6. **UI.** Follow `references/frontend.md`. For Vue, adapt
   `examples/vue-merk-step` from the brand-kit repo: map the tokens to the
   design system, point the client at the app proxy, and use this product's
   fallback colour. For other frameworks, reuse the logic from
   `@wisemen/brand-kit` (`applyAnalysis`, `resolveIcon`,
   `monogramColors`, `swatchesFor`) and rebuild only the view.

7. **Tests.** Use a mocked client and fixture results only. No real
   brand-service calls in CI. Cover:
   - that the proxy maps errors
   - the persistence of each icon kind
   - the step staying usable when analysis fails

8. **Leave a trail.** In this repo's `AGENTS.md`, add a short "Brand step"
   section listing:
   - the proxy module path
   - the env vars
   - the stored fields
   - a link to this skill

## Acceptance criteria

- [ ] Entering a website yields colours and an icon recommendation, and the user can override every choice.
- [ ] When the service fails, times out, is cancelled or finds nothing, the step stays usable with the fallback colour, the monogram and manual upload.
- [ ] Monogram letters meet WCAG AA on every chosen colour. This comes for free with `monogramColors`.
- [ ] The product's action/focus colour is unchanged by customer colours.
- [ ] The stored monogram is the outline SVG from `/brand/monogram`, not an HTML render.
- [ ] Uploaded SVGs are sanitised server-side and rendered only via `<img>`.
- [ ] The service key exists only in backend env. `grep` the frontend bundle to prove it.
- [ ] A restored draft does not trigger a new analysis. The re-analyse control sends `force: true`.
- [ ] Tests pass without network access.

## Stop and ask when

- The app cannot reach a brand-service instance. For example, it's deployed
  on-prem for a client. In-process mode (`@wisemen/nestjs-brand-extraction`)
  ships Chromium in the app and needs network isolation, so it's a deliberate
  decision, never a default.
- The customer model has no place for colours or an icon. Don't invent a
  schema migration without confirmation.
- The design system lacks an equivalent for a control and you would need to
  introduce a new UI dependency.
- Someone asks you to generate or "improve" logos with an image model. That
  contradicts principle II.

## Don'ts

- Don't call brand-service from the browser. Don't put `BRAND_SERVICE_API_KEY`
  in any `VITE_*` or public env var.
- Don't copy `color.ts`, letter logic or the client into the app.
- Don't render uploaded or returned SVG with `v-html` / `innerHTML`.
- Don't add Playwright/Chromium to the app unless in-process mode was
  explicitly approved.
- Don't translate or rephrase `icon.reason` by string matching. Show it, or
  hide it.
