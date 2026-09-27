# AGENTS.md — brand-kit monorepo

This repo turns a customer website into brand colours, a logo assessment and a
uniform square customer icon. It is used by several Wisemen applications.
Read `.specify/memory/constitution.md` before changing behaviour.

## Map

| Path | What | Published |
|---|---|---|
| `packages/brand-kit` | Contract types, isomorphic HTTP client, colour math, monogram letters, framework-free wizard helpers. **Zero dependencies.** | `@wisemen/brand-kit` |
| `packages/nestjs-brand-extraction` | The engine: Chromium render, logo candidates, vision judge, palette scoring, icon rendering. `BrandExtractionModule.forRoot()`; registers no routes. | `@wisemen/nestjs-brand-extraction` |
| `apps/brand-service` | Deployable HTTP service around the engine: `/v1/brand/*`, API key per consuming app, per-app rate limit, `/health`, Dockerfile. | Docker image |
| `examples/vue-merk-step` | Reference Vue 3 UI (WiseOS "Nieuwe klant · Merk"). Copy and adapt; not a library. | no |
| `packages/brand-kit/skills/integrate-brand-step` | Playbook for coding agents integrating the service **in another repo**. Shipped in the npm tarball and synced by `@wisemen/skills-cli`. | inside `@wisemen/brand-kit` |
| `docs/openapi.yaml` | HTTP contract for non-TypeScript consumers. | – |

## Commands

```bash
pnpm install
pnpm build                                  # topological: kit → engine → service
pnpm test                                   # all unit + offline e2e tests (no browser, no API)
pnpm -r typecheck
pnpm --filter @wisemen/nestjs-brand-extraction test:browser   # needs Chromium
pnpm --filter brand-service dev             # local service on :3000 (needs .env)
```

## Rules

- **Contract changes** start in `packages/brand-kit/src/contract.ts`. Update
  `docs/openapi.yaml` in the same change, and add a changeset
  (`pnpm changeset`). Adding a field is a minor change. Removing or renaming
  one is a major change.
- **brand-kit stays dependency-free** and runs in the browser and in Node. No
  `node:*` imports, no Buffer.
- **Never** copy `color.ts`, letters or client code into an app. Import the
  package.
- **Tests never hit real websites or the Anthropic API.** Use fixtures, the
  fake renderer and the local asset server patterns in
  `packages/nestjs-brand-extraction/test/pipeline.test.ts`.
- **Nest injection uses explicit `@Inject(Token)`**, so the code also works
  when built with esbuild/SWC/tsx (no emitted decorator metadata).
- **The in-page script (`collect-page-signals.script.ts`) is a JS string on
  purpose.** Don't convert it to a TS function.
- **Tuning** (`SOURCE_WEIGHTS`, merge distances, DOM logo scores) is done
  against a labelled site set, never by intuition. Attach before/after results
  to the PR.
- **UI copy returned by the service is Dutch (nl-BE).** Apps may translate by
  mapping `diagnostics.warnings` and `icon.recommendation`. `icon.reason` is
  free text.

## Releasing

`pnpm changeset` → merge → CI runs `pnpm release`, which publishes to npm
(`@wisemen` scope). A change to the skill needs a changeset too, because the
skill travels with the package version. The service image is built from
`apps/brand-service/Dockerfile` at the repo root.
