# Design System, UI Consistency & Design Quality

<!-- Feature ledger fragment. One block per node; flat list; hierarchy encoded in the dotted id. Schema: roadmap.d/README.md -->

- id: design-system
  name: Design system
  scope: UI consistency prevented by construction (tokens, one component source, CI) and design quality set by a human foundation with an enforced review step.
  status: partial
  slices: 0-7a-design-system-foundation
  adrs: ADR-0028, ADR-0053, ADR-0076
  spec: docs/specs/2026-06-10-design-system-foundation-design.md
  evidence: packages/design-tokens, packages/design-system (on main since 2026-07-02)
  notes: Foundation built and merged; close-out items open (NVDA passes, owner Storybook sign-off, first container VRT baselines, dark design pass).

- id: design-system.tokens
  name: Design tokens
  scope: Every color/spacing/radius/shadow/type/z/motion/breakpoint value a named DTCG token; no raw values elsewhere.
  status: partial
  adrs: ADR-0076
  evidence: packages/design-tokens/tokens, generated CSS custom properties

- id: design-system.tokens.dtcg-resolver
  name: DTCG source with Resolver theming
  scope: Spec-pure W3C DTCG source; themes and light/dark carried entirely by resolver contexts, pure data on html attributes.
  status: shipped
  surface: internal
  evidence: packages/design-tokens/resolver.json, tokens/modes/dark.json

- id: design-system.tokens.terrazzo-pipeline
  name: Terrazzo generation
  scope: Terrazzo build to committed CSS custom properties with golden-file byte pins and generator invariant gates (Style Dictionary portability accepted).
  status: shipped
  surface: internal
  evidence: packages/design-tokens/terrazzo.config.mjs, generated/

- id: design-system.tokens.theme-gallery
  name: Curated theme gallery
  scope: Six-theme gallery times light/dark modes as resolver contexts; adding a theme is a data change, zero component changes.
  status: shipped
  surface: screen
  evidence: packages/design-tokens tokens + WCAG contrast gates over every theme-mode pair

- id: design-system.tokens.per-firm-branding
  name: Per-firm branding generation
  scope: Generated accessible palettes from firm anchor colors via the Culori engine.
  status: partial
  surface: awaiting-screen
  evidence: packages/design-tokens/scripts (generate-theme with gamut mapping and contrast validation)
  notes: Engine built but unexposed to firms, matching the white paper's built-but-unexposed framing.

- id: design-system.tokens.tailwind-theme
  name: Tailwind v4 token binding
  scope: Tailwind configured via @theme to consume only generated tokens so off-scale values cannot be expressed naturally.
  status: shipped
  surface: internal
  evidence: packages/design-tokens/tailwind.template.css, apps/web Tailwind wiring

- id: design-system.components
  name: Component library
  scope: In-house @magna-carta/design-system styled directly on headless Bits UI v2 — the only primitives the app may compose.
  status: shipped
  adrs: ADR-0076
  evidence: packages/design-system/src/lib/components holds sixty component directories across four tiers, DataTable, Sidebar, Resizable and the brand components among them
  notes: shadcn-svelte (original choice) replaced after an adversarial stress test; Bits scroll-lock CSP patch carried in patches/.

- id: design-system.components.storybook-catalog
  name: Component catalog
  scope: Storybook as the single place components are defined and reviewed; stories triple as behavior tests and axe accessibility checks.
  status: shipped
  surface: internal
  evidence: packages/design-system storybook scripts, vitest.storybook.config.ts
  notes: Histoire dead without Svelte 5 support, as the white paper records.

- id: design-system.components.icons
  name: Lucide icons, no emojis
  scope: Lucide as the only icon source; emojis banned everywhere and machine-enforced.
  status: shipped
  surface: internal
  evidence: the @lucide/svelte dependency, plus the emoji scanner — rule 5 of the five in packages/design-system/test/fitness/off-token.test.ts, over the emoji supplementary planes and Miscellaneous Symbols, marked repo-wide so it sweeps every app's and package's UI source rather than this package's

- id: design-system.enforcement
  name: Machine enforcement
  scope: Lint forbids arbitrary/off-token values; catalog plus visual regression catch drift in CI.
  status: partial

- id: design-system.modal-shells
  name: Two modal shells and never a third
  scope: Every modal surface in the product is one of two shells — RecordWindow for reading and changing a record, ActionDialog for an act asked of a reader — with one shared unsaved-work guard, and a source scan that recognizes a panel built outside them.
  status: partial
  surface: internal
  spec: docs/specs/2026-09-01-consolidated-modal-architecture-design.md
  evidence: packages/design-system/src/lib/components/action-dialog (the shell, its kind table and its six stories), src/lib/internal/close-guard.svelte.ts + discard-question.svelte (the guard both shells share), tooling/lint-one-ui rules `hand-composed-modal` and `footer-set`
  notes: The shell, the shared guard, the two rules, and the frame both shells sit on (styles/recipes/modal-frame.css — the record window's pane system, extracted with byte-identical screenshots as proof) are built. Three families have migrated — the custodian's three panels, ten across billing and costs, and the new-matter window as the frame's first context-pane caller — and the matter-status window landed on a fourth kind, `reading`, added as a strict arm of the props union for a panel that states a fact and seats its step beside it. The shell then took the seams its first fifteen callers repeated: Enter commits (the pane is a form, the commit its submit), `subtitle` takes a string, and `commitSoon` renders a commit not served yet inside the Soon affordance — for which the maturity family moved whole into the design system — beside two field primitives, `LabelledField` and `FieldRow`. The confirmation family followed — the file manager's three panels, the note and party removals, the settings recap and the attachment detach — and the shell gained the `done` outcome for a commit that stays to show what it came to. The four forms followed — move to another ledger (the first caller of `commitSoon`), fold two directory records, a new person or organization (the first caller of `LabelledField` and `FieldRow`), and the conflicts answer. The three send panels followed — the issue report, the problem report and the settings change request — each staying open on `done` to show its reference, its copy seated beside what it copies. Twelve printed allowances remain, of which eleven are named exclusions with the shell or the dependency each belongs to; the last panel to migrate is the new-document flow.

- id: design-system.enforcement.off-token-lint
  name: Off-token value gates
  scope: Fitness gates rejecting arbitrary values, raw colors, raw z/duration numerals, bits-ui boundary violations, non-token CSS.
  status: shipped
  surface: internal
  evidence: packages/design-system/test/fitness/ — off-token.test.ts (five scanners over arbitrary values, raw colors, raw z and duration numerals, non-token CSS, and emojis, each with a crafted-violation self-check and a vacuity guard on the file set) and boundaries.test.ts for the bits-ui import boundary. Mutation-verified, zero allowances.

- id: design-system.enforcement.visual-regression
  name: Visual regression testing
  scope: Playwright screenshots across every theme and mode over the story matrix; Argos the named upgrade.
  status: partial
  surface: internal
  evidence: packages/design-system/visual-regression (harness + pinned Playwright container CI job)
  notes: Harness and CI job built; first container-rendered baselines still pending; Argos not adopted.

- id: design-system.design-language
  name: Design language foundation
  scope: Human-set distinctive, restrained language: type system, palette with intent, legal power-user density, functional motion, signature elements.
  status: shipped
  surface: internal
  spec: docs/specs/2026-06-12-design-language.md
  evidence: Engraved Ledger register folded into the system (self-hosted fonts, BrandMark, Masthead, gilt-draw Tabs)
  notes: Dark design pass named as a remaining close-out item.

- id: design-system.page-archetypes
  name: Page archetypes
  scope: Canonical page templates (List/Index, Record Detail, Editor, Form/Wizard, Dashboard) fixing layout grammar, hierarchy, and full state sets.
  status: shipped
  surface: internal
  spec: docs/specs/2026-06-12-page-archetypes.md
  evidence: Sidebar (Layout A) + app-shell components in packages/design-system
  notes: Archetype application across feature screens rides each UI slice.

- id: design-system.ui-pipeline
  name: UI build pipeline
  scope: Per-slice staged roles: interaction design, implementation, design critique against an anti-generic rubric, accessibility, visual regression.
  status: partial
  adrs: ADR-0053

- id: design-system.ui-pipeline.critique-rubric
  name: Design critique standard
  scope: Explicit anti-generic and usability rubric as the practitioner standard for the judgment gate.
  status: shipped
  surface: internal
  evidence: docs/conventions/ui-design.md

- id: design-system.ui-pipeline.accessibility
  name: Keyboard-first accessibility
  scope: Keyboard-first and WCAG; axe checks enforced in stories; screen-reader passes per tier.
  status: partial
  surface: internal
  evidence: packages/design-system/vitest.storybook.config.ts runs every story as a component test in headless Chromium with addon-a11y axe checks failing the run, so an accessibility regression is a test failure rather than a review note.
  notes: Per-tier NVDA passes pending per STATUS close-out list. The high-contrast axis is a working preference that only the checkbox and the switch answer, and its token context is deliberately unpopulated — see settings.area-ui.personal-preferences.

- id: design-system.fixtures-density
  name: Real-density UI data
  scope: UI built and reviewed on load-profile fixtures — real density, long values, empty states, large lists — never toy data.
  status: shipped
  surface: internal
  slices: load-profile-harness
  adrs: ADR-0083
  spec: docs/specs/2026-06-11-load-profile-harness-design.md
  evidence: packages/fixtures volume profiles + baselines; dev-seed route

- id: design-system.microcopy-glossary
  name: Domain-grounded microcopy
  scope: Microcopy drawn from a canonical legal-domain glossary shared with user documentation.
  status: not-started
  evidence: A shared glossary does exist, in the "Canonical terminology" table of docs/conventions/documentation-style.md — twelve use/avoid pairs binding all docs. It is not what this node describes: it governs prose rather than interface strings, nothing checks a component's copy against it, and the user documentation and the UI share no vocabulary source.
