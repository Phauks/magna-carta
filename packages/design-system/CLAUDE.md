# @magna-carta/design-system — CLAUDE.md

**Purpose.** The in-house styled component layer, built directly on headless Bits UI v2 — the only
place UI primitives are defined, styled, and reviewed. Every styled pixel is ours; behavior and
accessibility come from Bits. All styling flows from `@magna-carta/design-tokens` custom
properties; off-token values are machine-rejected.

**White paper:** _Design system, UI consistency & design quality_. (ADR-0076, superseding ADR-0028.)
**Spec:** [`docs/specs/2026-06-10-design-system-foundation-design.md`](../../docs/specs/2026-06-10-design-system-foundation-design.md).
**Plan:** [`docs/specs/2026-06-10-design-system-foundation-implementation-plan.md`](../../docs/specs/2026-06-10-design-system-foundation-implementation-plan.md).

## Key files / entry points

- `src/lib/internal/merge-classes.ts` — `mergeClasses()`, the single class-merge utility; carries
  the tailwind-merge registrations for token namespaces
- `src/lib/internal/types.ts` — the wrapper prop-type helpers (re-exported from bits-ui)
- `src/lib/internal/theme-preference.ts` — the theme/mode storage seam (localStorage now; slice
  0·7b swaps in the settings registry — this module is the only touch point) + the pure
  `applyThemeToDocument` used by both the app and the Storybook toolbar
- `src/lib/internal/floating.ts` — the ONLY home of z-index (`Z_LAYER_CLASSES`) and the presence
  animation constants; `floatingContentClasses()` is the canonical Tier 3/4 content-class builder
- `src/lib/styles/components.css` — the semantic component-class layer (`mc-*` recipes)
- `src/stories/**.stories.svelte` — the catalog; stories triple as browser-mode behavior tests and
  per-story axe checks
- `.storybook/` — catalog config; `catalog-matrix.ts` is the single theme/mode list
- `test/fitness/` — the golden-rule-2 gates (off-token, boundaries, components.css purity)
- `test/csp-spike/` — the CSP probe + `VERDICT.md` (re-runnable; asserts the verdict)
- `visual-regression/` — Playwright screenshots over the static Storybook build, theme×mode

## Invariants that apply here

- **Tokens + components only (golden rule 2, machine-checked).** No Tailwind arbitrary values, no
  raw color literals, no `z-<number>`/`duration-<number>` numerals — the fitness gates fail CI with
  file:line. The documented escape (`fitness-allow: <justification>`) feeds an asserted inventory;
  every allowance is a reviewed test edit.
- **`components.css` values are `var(--mc-…)` or structural keywords — no literals, no escape
  valve (deliberate).** Recipes must tokenize lengths: focus-ring width/offset and the 1px
  **`--mc-border-width-default`** hairline are dimension primitives added to design-tokens for
  exactly this reason — when a recipe needs a length with no token, add the token (regenerate +
  re-pin the golden in the same commit), do not reach for a literal or a keyword like `thin`.
- **`bits-ui` is imported only inside `src/`** (and the csp-spike probe) — gated.
- **Lucide deep imports only** (`@lucide/svelte/icons/<name>`) — gated.
- **Z and presence live in `floating.ts` only.** Apply `floatingContentClasses()` output to the
  inner `props` element, never the `wrapperProps` element (it carries Floating UI positioning —
  `FLOATING_WRAPPER_RULE`). Later `mergeClasses` inputs win, so caller overrides go last.
- **Reduced motion is structural:** every presence constant carries `motion-reduce:transition-none`
  (CSS-only). The first JS-driven animation must add the JS `prefersReducedMotion` gate — it does
  not exist yet.
- **Every component ships story-first**: stories cover every variant × state, run as behavior
  tests, pass axe (`a11y.test = "error"` — violations fail), and join the visual-regression matrix
  automatically. Each tier batch ends with an NVDA pass and an owner design review in Storybook.

## Dependencies & contracts

- `bits-ui` (pinned; upgrade together with `svelte`, deliberately), `clsx` + `tailwind-merge`
  (via `mergeClasses` only), `@magna-carta/design-tokens` (the styling contract).
- Storybook 10 + svelte-csf; the vitest browser project (`vitest.storybook.config.ts`) needs the
  Chromium Playwright binary (`tools/install-playwright-chromium.cmd`) — CI included.

## Gotchas

- **New token namespace in the generated theme → register it in `merge-classes.ts`** or
  conflicting utilities silently both survive. Named duration/z-style scales need
  `extend.classGroups` (tailwind-merge's `extend.theme` cannot model them); the theme-derived test
  will demand merge cases — follow its messages. Never hand-invent utility names outside the
  generated theme; unregistered ones fail silently.
- **No `vite.config.ts` in this package on purpose** — `svelte()` is registered in `.storybook/
main.ts` `viteFinal` and must stay UNSHIFTED (docgen/csf transforms expect compiled output). A
  package `svelte.config.js` exists for svelte-check. Root-cwd runs log a harmless
  "no Svelte config found" warning three times.
- **Story class strings must be literal** — Tailwind's scanner cannot see computed classes.
- **New theme** = one `catalog-matrix.ts` entry (+ the design-tokens side: theme file, resolver
  context, terrazzo `themes` array).
- **Any new browser-mode vitest config must also be added to the root `vite.config.ts` projects
  list** — Vitest silently ignores projects nested inside a project config.
- **Node 25 ships a dead `localStorage` global that happy-dom cannot replace** — stub storage via
  `vi.stubGlobal` (see `theme-preference.test.ts`).
- **CSP (`test/csp-spike/VERDICT.md`):** Floating UI positioning is CSP-clean; Bits' scroll-lock
  RESTORE uses `setAttribute("style", …)` — apply the documented one-line `pnpm patch`
  (`setAttribute` → `style.cssText`) with the FIRST scroll-locking Tier 3 component. Never loosen
  `style-src` instead. The spike asserts the verdict and fails if a bits-ui upgrade changes it.
- **Visual regression baselines are authoritative ONLY from the pinned Playwright container**
  (`update-baselines.cmd`/`.sh`; no Docker on the dev machine — first baselines land via CI).
  After any local VRT run, check `git status` for stray `visual-regression/baselines/*.png` —
  local Windows renders must never be committed.
- **`.cmd` files are ASCII-only** — multibyte characters (em-dashes) shear cmd.exe's parser under
  the UTF-8 codepage. `.gitattributes` pins `*.cmd` to CRLF.
- **Tokenize recipe lengths (focus-ring + border-width done):** the Button needed focus-ring
  width/offset tokens; the Tier 1 batch (Input/Card/Separator/Alert/Keyboard) needed
  `--mc-border-width-default`. Bare `0`, `calc(…)`, and `content: ""` in recipes likewise need
  tokens or a deliberate, reviewed gate widening.
- **Component-build conventions (Tier 1 batch, the loop every later component copies):**
  - **Single-element wrappers** are `WithElementRef<HTMLXAttributes, HTMLXElement>` + `mergeClasses("mc-x", className)`; **variant** components add the house `variants.ts` record (no DSL), as in button/badge/alert.
  - **Multi-part** components (Card, Alert) ship an index that exports the **house namespace shape** — bare part names (`Root`, `Header`, …) _plus_ prefixed aliases (`Card`, `CardHeader`, …) — so both `import * as Card` and `{ Card, CardHeader }` work.
  - **Name components in full** (golden rule 12): `Keyboard`, not `Kbd` — the HTML element stays `<kbd>`, but the component, recipe class (`mc-keyboard`), export, and story are spelled out.
  - **svelte-csf `defineMeta({ component })` needs a directly imported component identifier**, not a namespace member: import the root component file alongside `import * as X` for multi-part stories (Card/Alert stories show this).
  - **Layout width is a utility, not the recipe:** `inline-size: 100%` is not tokenizable (and `%` fails the purity gate), so form controls (Input/Textarea) and Separator carry `w-full`/`h-full` in the component class; the recipe owns visual design only.
  - **Focus is a single shape on EVERY focusable control — no detached ring.** Outline at `space-0` offset in `focus-ring`; controls with a resting border (Input/Textarea) also turn the border `focus-ring` so border + outline read as one merged edge, and the borderless Button gets a flush outline. (Owner-directed: a focus ring sitting away from the control read as a "double shape".)
  - **Input is text-like only** — `type="file"` is excluded from its type (`Omit<…,"type"> & { type?: Exclude<…,"file"> }`). File uploads are a separate concern (their own UX) and land as a dedicated component in slice 2·1; do not mix file handling into Input. `value`/`ref` are `$bindable`.
  - **Status surfaces use the gated solid pairing:** an Alert is a solid `status.<v>` panel with `status.<v>-foreground` (the AA-gated pair); a status colour as **text on a light surface is ungated and can fail AA** — do not use it until `status.*-subtle` tokens exist.
  - **Animations pulse between token colours, not opacity** (no opacity token; opacity literals are banned) and carry a `prefers-reduced-motion` guard (Skeleton).
- **Catalog model (owner-settled): one story per variant/instance; autodocs is the review surface.**
  - **One story per the component's main "variant" axis** (Button per variant; Alert/Badge per variant; Separator per orientation); a component with no variant axis is ONE story (Input, Textarea, Card, Label, Skeleton, Keyboard). **Every OTHER prop is a Control, not a story** — `size`, `disabled`, `href`, `placeholder`, `type` are toggled in the Controls panel, never enumerated as stories.
  - **No separate Playground** — the **first story IS the Docs-page Primary**, and autodocs wires the **Controls** panel to it.
  - **ALL controls live in the docgen "Properties" group — declare controllable props on the COMPONENT, not in story argTypes.** A prop defined only in a story's `argTypes` that has no matching component prop renders in a SEPARATE group that floats above "Properties" (the docgen group; its name is not settable, so you cannot merge into it via `table.category`). So commonly-controlled native attributes (`disabled`, `href`, `placeholder`) are declared EXPLICITLY on the component with a **JSDoc comment** (docgen reads it for the description) instead of being left to the `...restProps` spread — then they appear under "Properties" with descriptions, no floating, no extra category. Story `argTypes` are used ONLY to give enum props (`variant`, `size`, `orientation`) their explicit `control: "select"` + `options` (those props are already on the component, so they stay in "Properties").
  - **autodocs is on** (`tags: ["autodocs"]` in `preview.ts`; `@storybook/addon-docs`): each component's **Docs page is the single review surface** — description → controllable Primary + Controls → the auto "Properties" table → every instance as its own labelled block. Storybook cannot auto-generate a variant matrix from types; the per-instance stories ARE the showcase.
  - **Behaviour not visible on a showcase story rides a hidden test-only story** tagged `["!dev", "!autodocs"]` — it runs in the test addon but is absent from the sidebar and the Docs page (Button's `Behaviour` story tests submit-proof type, disabled-blocks-click, and href→anchor, none of which a variant story shows). Where the behaviour IS on a visible instance story (Alert role, Input typed/disabled, Label focus), keep the assertion there.
  - **Never two stories rendering the SAME thing** (duplicates stack on the Docs page — the owner saw "two cards on top of each other").
  - **Visual-tests addon** (`@chromatic-com/storybook`) is installed but **inert** until a Chromatic token is set; the recorded primary VRT is the self-hosted Playwright harness (Argos the named upgrade) — revisit which SaaS before relying on Chromatic.
- **`#NNNN` issue references in `src/` comments trip the raw-hex gate** (four hex digits) — cite
  issues in full URL form or use a justified `fitness-allow`.
- **Open spec item:** the no-emoji fitness gate is specced but unimplemented (decide at CI wiring,
  plan Task 28/29).
- **Workshop agenda (z-order):** `dropdown` (1000) sits below `sticky` (1100) — portal-to-body
  menus paint beneath sticky headers; defensible, but make it a deliberate decision.
