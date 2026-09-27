# Brand kit constitution

Stable principles. They change rarely and only on purpose. Specs, plans and
code in this repo and in every app that integrates the brand service must
comply. When a request conflicts with a principle, stop and ask.

## I. Uniformity over fidelity

The square customer icon is a product element, not a copy of the customer's
logo. The default is the fixed monogram template: 1–3 letters on the
customer's primary colour. A customer logo is used in the square only when
the vision check judges it legible at 48 px. A consistent monogram beats an
illegible or wrong logo.

## II. The model judges, it never draws

The vision model classifies and chooses between existing assets. It never
generates or edits imagery. Every model output is schema-validated. If the
model is unavailable, a deterministic heuristic decides instead. The user
flow never blocks on the model.

## III. Deterministic core

These are pure, tested functions:
- colour extraction and scoring
- contrast
- symbol cropping
- icon rendering
- monogram letters

The same input produces the same output.

## IV. One contract, shared code

Types, colour math, letters and the HTTP client live in
`@wisemen/brand-kit`. No app re-implements or copies them, so the
preview and the stored asset can never disagree.

## V. Chromium lives in one place

Rendering third-party websites is heavy and risky. It happens only in
`brand-service`, which runs network-isolated with no route to internal
ranges or cloud metadata. App backends call the service. Browsers never
call it directly, and never hold its key.

## VI. Readability is guaranteed

Customer colours never replace the product's action colour. Buttons, focus
and status colours stay the product's own. Text on a customer colour is
always WCAG AA, achieved by choosing white or ink letters, or by darkening
the colour in OKLCH while keeping its hue.

## VII. Never block the user

Every failure mode ends in a usable state: the product defaults plus manual
upload. Examples are an unreachable site, bot protection, a timeout, no
colour found, or the user cancelling.

## VIII. Untrusted input stays untrusted

These are all data, never instructions or markup:
- customer URLs
- scraped HTML
- fetched images
- uploaded SVGs
- model output

URLs pass the SSRF guard. SVGs are sanitised before storage and are only
rendered through `<img>`.
