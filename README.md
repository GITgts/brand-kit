# brand-kit

Website → brand colours, a logo check and a uniform square customer icon, for
every Wisemen application that creates customers.

```
Browser (any app)  ──►  App backend (proxy + storage)  ──►  brand-service  ──►  Chromium · Claude vision
      brand-kit                    brand-kit                  nestjs-brand-extraction
```

- **One service** runs the heavy, risky part (rendering third-party sites)
  in one hardened, network-isolated place. It is shared by all apps, with a
  shared cache and one place to tune quality.
- **One small package** (`@wisemen/brand-kit`, zero dependencies)
  gives every app the same contract, client, colour math and wizard logic.
  What the UI previews is exactly what the service stores.
- **One agent skill** ships inside `@wisemen/brand-kit`
  (`packages/brand-kit/skills/integrate-brand-step`). `@wisemen/skills-cli`
  syncs it into every repo that installs the package, so a coding agent adds
  the feature the same way every time.

## One-time setup

1. **Repo:** push this monorepo to GitHub (for example `wisemen-digital/brand-kit`).
2. **Packages:** run `pnpm changeset` → `pnpm release`. This publishes
   `@wisemen/brand-kit` and `@wisemen/nestjs-brand-extraction` to npm under
   the `@wisemen` scope, the same way as the other `@wisemen/*` packages.
   That keeps the existing `minimumReleaseAgeExclude: '@wisemen/*'` working.
   Decide on public versus restricted access; restricted needs an npm token
   in consumer CI.
3. **Service:** build with `docker build -f apps/brand-service/Dockerfile -t brand-service .`
   and deploy it with the env from `apps/brand-service/.env.example`.
   - Put the brand font in `apps/brand-service/fonts/`.
   - Give it egress to the internet but **no route to internal networks or
     cloud metadata**.
   - Size it at about 1 GB RAM per 2 concurrent renders.
4. **Keys:** issue one key per consuming app in `BRAND_SERVICE_API_KEYS`
   (`wiseos:…,taxi-hendriks:…`). Each app stores only its own key, backend
   side.
5. **Skill:** nothing extra to do. Every repo with `@wisemen/skills-cli` in
   `postinstall` gets the skill on `pnpm install`.

## Adding it to an app (hand this to the coding agent)

Paste this in the app repo, with the skill available:

```text
Add the customer brand step to this app using the integrate-brand-step skill
(synced from @wisemen/brand-kit into .agents/skills/packages@…).

Context:
- Host screen: <e.g. "Nieuwe klant" wizard, step 2 "Merk">
- Website and company name come from: <e.g. draft.company.website / draft.company.name>
- Product action colour (fallback): <e.g. #4F46E5>
- brand-service URL for dev: <url>; the API key is in the team vault as <name>

Start with the spec (references/spec-template.md) and list the open questions
before writing code. Follow the acceptance criteria in SKILL.md; tests must run
without network access.
```

## Repo layout, commands, rules

See `AGENTS.md`. The principles are in `.specify/memory/constitution.md`, and
the HTTP contract is in `docs/openapi.yaml`.
