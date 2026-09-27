# Spec: Customer brand step — <APP NAME>

<!-- Checklist of what the spec must cover. Write it in the repo's own spec format and fill in every <…>. -->

## Why

Customers created in <APP> get consistent, recognisable square icons and
brand colours without manual design work. This keeps lists, avatars and
tenant spaces uniform.

## User story

As a <role> creating a customer, I enter the company website once. Then I
get a suggested icon and brand colours that I can accept or change in a few
clicks, without leaving the flow.

## Scope

- Host screen: <wizard step / customer form section / settings page>
- Inputs available at that point: website <field path>, company name <field path>
- Stored on the customer: `brandPrimary`, `brandAccent`, `iconFileId`, `iconKind`, `iconBackground` <or existing equivalents>
- Where the icon is shown afterwards: <lists, sidebar, tenant header, emails, PDFs…>
- Product fallback / action colour: <hex> (customer colours never replace it)
- Language of UI copy: <nl-BE / i18n keys>

## Out of scope

- Generating or editing logos with AI
- Editing icons after creation (<unless requested>)
- Bulk backfill for existing customers (separate spec)

## Functional requirements

1. On entering the step with a website and no stored analysis, the analysis starts automatically and shows progress. The user can stop it.
2. The results show a primary and accent colour with up to 6 swatches, plus a custom colour picker.
3. The icon offers three options: monogram (editable letters, 1–3), website logo (disabled when none is found), and own file (SVG/PNG, square, at least 256 px, at most 2 MB). The recommended option is marked, and the service's reason is shown.
4. "Re-analyse" forces a fresh analysis. A user upload survives re-analysis.
5. Any failure leaves a usable step: the fallback colour, the monogram and upload stay available, and a clear message is shown.
6. Continue stores the colours and the final icon asset. The monogram is fetched as an outline SVG from `/brand/monogram`.

## Non-functional

- Service key only in backend env. The browser talks to `/api/brand/*` only.
- Per-user rate limit on `/brand/extract`: <10/min>.
- Uploaded SVGs are sanitised server-side and rendered via `<img>` only.
- Monogram text is WCAG AA on every colour.
- Tests run without network.

## Open questions

- [ ] <Does the customer model already have colour/icon fields?>
- [ ] <Which brand-service environment and key does this app use?>
- [ ] <Is there a tenant/first-screen preview in this product?>

---

# Tasks

<!-- Copy to specs/<NNN>-customer-brand/tasks.md. Keep the order: contract before UI. -->

- [ ] T1 Install `@wisemen/brand-kit` in the backend and frontend (pnpm catalog if present).
- [ ] T2 Add env `BRAND_SERVICE_URL`, `BRAND_SERVICE_API_KEY` to the validation schema and `.env.example`.
- [ ] T3 Backend `BrandModule` with `BRAND_CLIENT` provider, and `BrandController` (`/brand/extract`, `/brand/monogram`), with auth guard and throttle.
- [ ] T4 Controller tests with a fake `BrandClient` (error mapping).
- [ ] T5 Customer fields plus migration (only if confirmed in Open questions).
- [ ] T6 Persistence of `BrandStepResult`: decode, sanitise SVG, store through the file module, save fields. Tests per icon kind plus a malicious SVG.
- [ ] T7 UI: adapt the Vue reference (tokens, client, fallback colour, copy) and wire it into the host screen via `v-model`.
- [ ] T8 UI tests with a fake client: auto-analyse, restore without re-analyse, failure state, continue emits the result.
- [ ] T9 Show the stored icon wherever customers are listed (a shared `CustomerIcon` component).
- [ ] T10 Add a "Brand step" section to `AGENTS.md` (paths, env, fields, link to this skill).
