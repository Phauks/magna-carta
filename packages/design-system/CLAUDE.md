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
- `src/lib/internal/close-guard.svelte.ts` + `discard-question.svelte` — the unsaved-work guard and
  the question BOTH modal shells run every exit through; owned here, never re-implemented in a shell
- `src/lib/components/action-dialog/` — `ActionDialog`, the one panel an act is asked for in;
  `action-dialog-model.ts` holds the kind table (what each kind implies) as data, not `{#if}`
- `src/lib/components/dropdown-menu/hover-open.ts` — the hover activation every DropdownMenu gets:
  the timing, the focus rules, and the one-hover-menu-at-a-time arbitration, shared from Root to
  Trigger/Content/SubContent through context (`openOnHover={false}` on Root keeps a menu click-only)
- `src/lib/styles/components.css` — the semantic component-class layer (`mc-*` recipes)
- `src/stories/**.stories.svelte` — the catalog; stories triple as browser-mode behavior tests and
  per-story axe checks
- `.storybook/` — catalog config; `catalog-matrix.ts` is the single theme/mode list
- `test/fitness/` — the golden-rule-2 gates (off-token, boundaries, components.css purity)
- `test/csp-spike/` — the CSP probe + `VERDICT.md` (re-runnable; asserts the verdict)
- `visual-regression/` — Playwright screenshots over the static Storybook build, theme×mode

## Two modal shells, and never a third

**Every modal surface in the product is `RecordWindow` (reading and changing a record) or
`ActionDialog` (an act asked of a reader).** A screen does not compose `Dialog.Content` /
`AlertDialog.Content` / `Sheet.Content` into a panel of its own — `lint:one-ui`'s
`hand-composed-modal` rule fails it, and the homes allowed to compose one are DECLARED in
`tooling/lint-one-ui/registry.json` (`modalShells`), not hardcoded in the rule. Being a registered
component is not enough on its own: `RecordAttachments` is registered and its detach confirmation
is still an `ActionDialog` inside it, not a panel of its own.

- **What `ActionDialog` owns, it owns by having no prop for it**: the footer's geometry and the
  order of its two controls, the dismissal's word, the busy state, whether the corner dismiss shows,
  which primitive renders the panel, and the one close path every exit runs through. There is no
  `class` prop. A caller differs on a closed set — `fields`, `notice`, `kind`, `width`, and a commit
  returning `"committed" | "refused"`.
- **`kind` selects the primitive.** `form` → `Dialog` (corner dismiss, dismissed by a press
  outside); `confirm`/`destructive` → `AlertDialog` (the `alertdialog` role, no incidental dismiss).
  The dismissal says "Cancel" for every acting kind, held as one constant. The trait table describes
  what Bits already does rather than fighting it.
- **`kind="reading"` is the fourth kind, and it is an arm of a discriminated union, not an
  optional commit.** A reading panel — the matter-status window is the model — states a fact and
  seats any step it offers in the body beside that fact, so its bar holds one control that says
  "Close" (nothing was begun). The props type has two arms: acting kinds REQUIRE `commitLabel` and
  `onCommit`; the reading kind forbids them (`?: never`). Neither arm got weaker to admit the other.
  Its row in the kind table carries `commitVariant: null`, which is what hides the commit; it runs
  no unsaved-work guard unless the caller says `unsavedChanges`. It is not a read-only
  `RecordWindow`: a record with tabs, history or an editing mode still opens in the record window.
- **The primary pane is a `<form>` and the commit is its submit button, by `form` attribute.** That
  is how Enter commits in every panel without a caller wiring it: the platform's implicit submission
  presses the form's default button, and only while it is enabled, so a refused or `commitSoon`
  commit refuses Enter too. Ctrl+Enter or Cmd+Enter commits from a textarea (the form's keydown
  listener; the a11y warning on it is ignored with its reason). The form is `novalidate` — a refusal
  is stated beside the commit, never as a browser bubble. A caller must not put a second `<form>`
  inside `fields`, and a raw `<button>` inside it needs `type="button"` (the design system's Button
  already defaults to it).
- **`subtitle` is `string | Snippet`.** A string where it is plain text (most panels); a snippet
  where it carries markup. Rendered through one `subtitleContent` snippet in the shell.
- **`commitSoon: { reason }` is the acting arm's seam for an act not served yet.** The shell wraps
  its own commit in `SoonAffordance` (`../maturity`), so the commit is disabled with the Soon mark
  beside it and the dependency as its accessible description. The commit is ONE snippet rendered
  one of two ways so the bar holds exactly one `<Button` carrying the commit marker in this file's
  source — that is what keeps `footer-set` true; do not duplicate the control to add a branch.
- **`restoreFocus={false}` is the one focus seam, for a trigger revealed on focus.** Bits returns
  focus to the trigger on close; a per-row control that reveals on focus then stays latched open
  after the panel has gone (owner-reported twice on the settings rows). The default is true and
  right for every other trigger; do not reach for it to tidy focus elsewhere.
- **The `notice` slot is the layering seam.** The design system cannot know what a failure reads
  like, so the shell reserves the PLACE and the app puts `FailureNotice` in it. Never import an app
  module here to close that gap.
- **The commit owns the close.** `onCommit` reports an outcome; the shell closes on `"committed"`,
  stands its ground on `"refused"`, and on `"done"` stays open as a panel with nothing left to ask:
  the commit leaves the bar, the dismissal reads Close, the guard stands down, and `fields` /
  `context` are handed `done` so one snippet shows what the act came to (a reference, a batch
  still landing). A caller never writes `open` on the way out — that is what keeps the close to
  one path, and a one-entrance close path is the only kind a guard can cover. A host MAY close a
  done panel itself by writing the bound `open` (the upload panel's host does, once the last file
  lands); that is a prop changing, not a gesture, and runs no guard.
- **Both shells stamp `data-modal-shell`** on their panel, and `ActionDialog`'s two footer controls
  carry `data-action-dialog-action`. These are the hooks a scan and a rendered-DOM check read;
  `footer-set` asserts the bar against the shell's source the way `header-set` asserts the record
  window's header. Do not remove or rename them to tidy up markup.
- **Both shells sit on one frame — `styles/recipes/modal-frame.css` — and no panel builds a pane
  system.** The frame is the record window's own, extracted: `mc-modal-frame` (the panel),
  `-header` / `-identity` / `-heading` / `-subtitle` / `-header-actions` / `-header-action`,
  `-body`, `-pane` (the primary pane, which stops at `size.record-pane` beside a context and fills
  the frame when alone via `:only-child`), `-context` (+ `-context-body` for a context that is not
  tabs), `-notice` (outside the scroll, directly above the bar; `:empty` collapses it), and
  `-actions`. `RecordWindow` keeps every `mc-record-window-*` name as a hook beside the frame's
  class; its own recipe is the tab strip only. Do not re-declare any of these in a shell's recipe,
  and do not give `ActionDialog` a `class` prop to reach past them. A form that needs something
  beside its fields hands `ActionDialog` a `context` snippet; a context pane implies the record
  width, whatever `width` said.
- **The frame owns expand, and each shell keeps its own control.** `internal/frame-expansion.svelte.ts`
  holds the state, the per-shell session memory (`recordWindowExpansion`, `actionDialogExpansion`
  — never persisted, never shared between the shells), the two control names, and the expanded
  geometry (`EXPANDED_FRAME_CLASSES`, utilities, since only a utility can replace the panel's own
  cap). The corner control's markup stays in each shell's source because `header-set` asserts the
  record window's set at the source. `ActionDialog` offers expand on the kinds with something to
  gain — `form` and `reading`, the Dialog kinds; `expandable` in the trait table — and never on a
  question. Both shells take a bindable `expanded`, which is also how a panel OPENS expanded by
  design; the caller's binding wins over the memory.
- **The frame is imported after `dialog.css` and `alert-dialog.css` and before `record-window.css`**
  in `styles/components.css`, because it overrides the panels' padding, gap and overflow at equal
  specificity and the record window's tab strip overrides Tabs at equal specificity. Moving the
  import breaks one or the other silently.
- **The standard for touching the frame is byte-identical screenshots** of the record window's four
  frame-bearing stories (default, editing-in-place, fits-without-scrolling,
  caps-and-scrolls-its-body) from the static catalog before and after. The extraction met it; a
  change to the frame that cannot is a change to the owner's pane system and needs the owner.
- **The unit test project carries `svelte()`** (in `vitest.config.ts`, at the top level AND on the
  `unit` project) because `.svelte.ts` runes modules — the close guard — do not compile without it;
  from the repo root only the top-level fallback is used, so a plugin on the project alone passes
  locally and fails in `pnpm test`. The package still has no `vite.config.ts`; that note is about
  the Storybook pipeline's plugin ORDER, which this does not touch.

## The directory-linking family: one mark, one field, one tab

**Every surface that names, picks or links a person or an organization goes through
`EntityIdentity`, `EntityPicker` and `RecordParties`** (`src/lib/components/entity-identity`,
`entity-picker`, `record-parties`). Three app surfaces had each hand-built a combobox over the
directory search before these existed; the one-implementation registry now refuses a fourth.

- **The picker never fetches.** It takes `search: EntitySearch` and owns the settle, the floor, the
  abort of a superseded question and the three states (`picker-search.ts`, tested on its own). The
  app supplies the directory — `apps/web/src/lib/directory/directory-picker-source.ts` is the one
  adapter. Same layering as `ActionDialog`'s `notice` slot: the design system knows how a search
  behaves, never what is searched.
- **A failed search is stated, never rendered as no matches.** The two are the same picture and not
  the same fact. A capped answer says so and is never re-sorted: the order is the server's.
- **An association carries its own identity apart from the entity's** (`RecordParty.identifier` vs
  `entityIdentifier`), which is what lets one person be on a record twice in two roles and never
  twice in one (`linkable-entities.ts`), and what lets removing a link leave the person in the
  directory. The remove control is the `unlink` glyph, never a waste bin, never the danger colour.
- **The tab's confirmation is an `ActionDialog`**, from the first commit — the attachments tab
  carries an allowance for its hand-composed one; this family does not.
- **`PARTIES_TAB_KEY`** is the agreement every record window imports, the twin of
  `ATTACHMENTS_TAB_KEY`.

## The maturity family, and the field primitives

- **`src/lib/components/maturity/` is the one home of the maturity vocabulary** — the stage model
  (`maturity.ts`: `MaturityStage`, `MATURITY_PRESENTATION`, `hasSurface`), `MaturityBadge`,
  `MaturityDot`, and `SoonAffordance` with its wording (`soon-affordance.ts`). It moved here from
  `apps/web/src/lib/maturity/` on 2026-09-02 because the ActionDialog shell renders the "soon" stage
  on a commit and a shell cannot import the app. The app imports `@magna-carta/design-system/maturity`
  and keeps only its registries' `stage` fields. `SoonAffordance` is in `lint:one-ui`'s
  one-implementation registry: a second composition of "disabled + badge + dependency" anywhere is
  the defect it exists to prevent. Only `soon` wears a mark (owner ruling in
  `docs/conventions/design-corrections.md`).
- **`LabelledField` is the label-over-control stack for a panel's own fields; `Form.Field` is for a
  superforms-validated form.** They are not interchangeable and one is not a shortcut for the other.
  `LabelledField` mints the control's id (`$props.id()`) unless given one, joins the hint and the
  error into `aria-describedby`, sets `aria-invalid` on an error, and hands the control its
  attributes as `children({ props })` to spread — formsnap's own idiom. Its recipe gap is space-8
  (the panels'); `mc-form-field` is space-4. That difference is deliberate and stated on the recipe;
  do not quietly align one to the other — it is the owner's to settle. The hint and error reuse
  `mc-form-description` / `mc-form-errors`, so the satellites are one recipe across both.
- **`FieldRow` is utilities, not a recipe** (`grid gap-12 sm:grid-cols-2|3`), because a breakpoint
  cannot be expressed with a custom property inside a media query. Its class strings are literal in
  `field-row/variants.ts` for Tailwind's scanner.

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
  Two reviewed widenings (2026-07-02): the exact form **`content: ""`** is structural (enables
  pseudo-element ornament; non-empty strings still violate), and **physical box properties are
  banned** (`width`/`margin-left`/`border-top`…) — recipes are logical-property only so RTL keeps
  working; the WebKit scrollbar recipe is the sole exemption.
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
- **Storybook coverage toggle errors ("Cannot find package '@vitest/coverage-v8'") — flagged for
  Fable, deferred.** Tests run fine (CLI `vp test` green, and the Storybook test panel runs without
  the coverage toggle); only the addon's coverage feature fails, because Vite+'s test runner
  lazy-imports `@vitest/coverage-v8`, which isn't installed. Wiring it is non-trivial: catalog pins
  `vitest: 4.1.8` but an `overrides` block aliases `vitest` to Vite+'s own dist
  (`@voidzero-dev/vite-plus-test`), and coverage providers hook deep into vitest internals — so a
  stock `@vitest/coverage-v8@4.1.8` must be verified against the aliased runtime (fork/upstream
  identity mismatch is the risk). To enable: add `@vitest/coverage-v8` (matching 4.1.8) to the
  catalog + root devDeps, install, and confirm coverage actually runs under the alias.
- **Node 25 ships a dead `localStorage` global that happy-dom cannot replace** — stub storage via
  `vi.stubGlobal` (see `theme-preference.test.ts`).
- **CSP (`test/csp-spike/VERDICT.md`):** Floating UI positioning is CSP-clean; Bits' scroll-lock
  RESTORE used `setAttribute("style", …)`, which strict `style-src` blocks. **Patched** with the
  first scroll-locking Tier 3 component (Dialog): `patches/bits-ui@2.18.1.patch` rewrites the
  restore to `style.cssText` (the CSP-clean CSSOM channel). Never loosen `style-src` instead. The
  spike asserts the patched verdict and fails if a bits-ui upgrade regresses it — re-run on every
  bits-ui/svelte bump (`tools/run-csp-spike.cmd`) and drop the patch if #1995 lands upstream.
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
  - **Component naming / casing standard** (owner-settled 2026-06-13; matches the Radix/shadcn ecosystem): components are **PascalCase**. A component that wraps a **single HTML element takes that element's own spelling** — `Input` (`<input>`), `Textarea` (`<textarea>` — lowercase `a`, as HTML spells the element), `Label`. A **compound concept or multi-part set is PascalCase per word** — `FileInput`, `RadioGroup`, `CardHeader`/`AlertTitle`. The **recipe class is the kebab-case of the component name** (`mc-input`, `mc-textarea`, `mc-file-input`, `mc-radio-group`). So `Textarea` (element-mirror) and `FileInput` (compound) are each correct, not inconsistent.
  - **svelte-csf `defineMeta({ component })` needs a directly imported component identifier**, not a namespace member: import the root component file alongside `import * as X` for multi-part stories (Card/Alert stories show this).
  - **Always render via an explicit `{template}` snippet — NEVER bare `<Story>…</Story>` element children** (when `component` is set, which it always is). svelte-csf renders the `component` with args and slots bare children INSIDE it, so the story content gets wrapped in a second copy of the component: it double-rendered Card (nested cards), nested an outer `<label>` around Label's row, and (Skeleton being a leaf with no `{@render children()}`) DROPPED the content entirely — an empty, invisible skeleton. All three passed their play functions, so this is invisible to the test gate — the trap is real. Define a `{#snippet template(args?)}` and pass `{template}` (Button/Alert/Input are the reference); a `{#snippet template()}` written _inside_ the `<Story>` tags is also fine (it's a named template, not bare children).
  - **Layout width is a utility, not the recipe:** `inline-size: 100%` is not tokenizable (and `%` fails the purity gate), so form controls (Input/Textarea) and Separator carry `w-full`/`h-full` in the component class; the recipe owns visual design only.
  - **Focus is a single shape on EVERY focusable control — no detached ring.** Outline at `space-0` offset in `focus-ring`; controls with a resting border (Input/Textarea) also turn the border `focus-ring` so border + outline read as one merged edge, and the borderless Button gets a flush outline. (Owner-directed: a focus ring sitting away from the control read as a "double shape".)
  - **Input is text-like only** — `type` is the closed text-like union (`Omit<…,"type"> & { type?: InputType }`, the exported `InputType`); file/checkbox/radio/range/color and the button types are out because the text-field recipe can't dress them. The story gives `type` an explicit `control: "select"` (a closed set is a dropdown, never a free-text control). `value`/`ref` are `$bindable`.
  - **FileInput is the styled `type="file"` control** — its own component (`mc-file-input`) because a file control's value is user-set and read-only (`input.files` is not generically assignable, so it does NOT two-way bind — read the selection from the element `ref` or a forwarded `onchange`), and its only reliably-styleable part is `::file-selector-button` (dressed to the secondary-button look; vertical centring via `align-content: center` + the button on `vertical-align: baseline` to share the filename text's baseline — NOT a flex row, which would strand the button on the baseline overlapping the top). This is the bare control only; the full upload UX (drag-and-drop, selected-file list, progress, validation, R2 wiring) builds on it in slice 2·1.
  - **Specialized inputs are dedicated components, not Input types** (the pattern FileInput sets) — they live in the **Compound Inputs** catalog category (see the taxonomy below). Planned, NOT built here — flagged so they aren't crammed into Input later:
    - **MoneyInput** (billing/trust UI slice): currency symbol + locale formatting, bound to **`@magna-carta/money`** (branded `Money` over minor-units — never floats), precision/rounding and validation from the money package. `type="number"` is the interim for raw amounts.
    - **PhoneInput** (compound): a country/dial-code selector + national-number field, with formatting and validation (libphonenumber-class). `type="tel"` Input is only raw text entry — `tel` is unvalidated by the platform, so a real phone field needs the compound. QoL idea: surface what the area/dialing code maps to (region) as a hint.
    - **Calendar / DatePicker family** (Tier 3/4, on bits-ui + **`@internationalized/date`**): the native `date`/`datetime-local`/`month`/`week`/`time` Input types are a thin interim. In particular **native `type="week"` is hard-locked to ISO 8601 (Monday-start, ISO week numbers) — not locale-aware, not configurable**; firm/locale-configurable week-start (Sunday/Saturday/Monday) requires the custom picker, where week-start is driven by locale and/or a firm setting (ADR-0040). `@internationalized/date` (the ADR-0055 civil date) supplies locale-aware `startOfWeek`/week-info.
    - **Country selector / State·Province·County (admin-subdivision) selector**: data-backed Selects (on the future Select/Combobox, Tier 3), populated from a reference dataset and searchable; Country feeds PhoneInput's dial code AND drives the subdivision list + postal format. Address-field family.
    - **AddressFields** (compound, locale-adaptive): address line(s), City, State/Region, Postal/ZIP (+ ZIP+4). The field SET, labels, and order change by country — do NOT hardcode US `state`/`zip`; follow libaddressinput/Google address-i18n patterns, keyed off the Country selector.
    - **PaymentFields** (credit card): **do NOT build raw card-number (PAN) inputs** — wrap the payment processor's tokenized/hosted fields (Stripe-Elements-style) so raw card data never touches our app and **PCI-DSS** scope stays out. Card-type detection / Luhn / expiry / CVC formatting are the processor's, not ours.
    - **National / Tax ID** (SSN, EIN / NINO, Company No.): **jurisdiction-aware** (not US-hardcoded), masked display (show last 4), strict per-jurisdiction format. Sensitive **PII** — golden rule 4 (never logged) + the secrets/encryption invariants (encrypted at rest).
    - **ColorPicker** (theming/firm-settings, with 0·7b settings registry): bespoke (Bits has no color primitive), built on **Culori** so it speaks **OKLCH** and gamut-maps — NOT native `type="color"` (sRGB hex, no gamut, no OKLCH anchors). Its brand-color use feeds `@magna-carta/design-tokens`'s `scripts/generate-theme.ts` (brand hue/chroma/neutral-tint anchors → generated ramps); a generation-time contrast check already exists there. Note: launch theming is the curated theme **gallery** (ADR-0040 firm setting) — a custom-brand picker is the UI for the generation engine's custom path, a step beyond the gallery.
    - **Cross-cutting:** most of these need ONE shared **input-mask primitive** (phone/card/SSN/EIN/ZIP+4/date all format-mask — decide the masking approach once, not per component), and most depend on the Tier 3 **Select/Combobox** landing first.
      All owner-flagged 2026-06-13.
  - **The two auth compounds are BUILT** (they left the planned list above when the sign-in screen landed):
    - **PasswordInput** — composes Input (it does not restyle one, so the field keeps the single text-field recipe) and adds an in-field Show/Hide toggle: a real `type="button"`, `aria-pressed`, and an accessible name that CHANGES with the state ("Show password" / "Hide password") so a reader announces what pressing it will do. The toggle is its own small recipe rather than a ghost Button because it must fill the field's block extent and carry no control height of its own — the Button recipe's `min-block-size` + padding fight both. The revealed value is never logged or emitted (golden rule 4).
    - **VerificationCodeInput** — the segmented one-time-code control over **bits-ui PinInput**. Bits keeps ONE hidden input stretched across the row and the cells are presentational boxes marked `data-active` under the caret; that is what gives typing/backspace/arrow/paste behaviour for free AND what makes platform autofill work (`autocomplete="one-time-code"` on a single target, where six inputs would offer autofill six disjoint ones). The active cell takes the field's merged focus edge — the caret position IS the focus indicator — and disabled is read off the hidden input with `:has()`, since the state lives on the input while the muting lands on the cells. Digits are set in the **display serif at the 2xl step**: the second recipe (after Masthead) allowed through that door, because a code is a short ceremonial transcription where the reading face's tight sans makes 0/O and 1/l work harder than they should. Its `inputId` prop is what a `<Label for>` binds to; `inputRef` is bindable so a consumer can `focus()` it.
    - **Input gained a `size` axis** in the same pass (`sm | default | lg` → the same `--mc-density-control-*` heights the Button uses, via `input/variants.ts`), because the auth fields are large controls and a height is not a utility concern. It deliberately **shadows the native `size` attribute** (a character count — a pre-CSS layout mechanism this recipe set has no use for); field width is a utility. The one consumer that used the native form (the WHOIS query field) moved to a width utility.
  - **Disabled must read at REST, not only on hover** (owner-directed 2026-06-13): a `:disabled` rule mutes COLOUR (`action-disabled` / `action-disabled-foreground`), never just `cursor: not-allowed`. Place `:disabled` rules AFTER the active/checked rules so they win at equal specificity — Switch/RadioGroup/Accordion were fixed for exactly this (their disabled state was invisible until hover); Checkbox is the reference.
  - **Clickable means `cursor: pointer`** (owner-directed): every interactive surface — buttons, the selectable rows (menu/select/command/combobox items), and the select/combobox triggers — uses `cursor: pointer`, not the Radix/shadcn `default`. Disabled stays `cursor: not-allowed`. (The owner expects the cursor to signal selectability; do not reintroduce `cursor: default` on a clickable.)
  - **Select (Tier 4) — bits-ui quirks the Command/Combobox share:**
    - **`Select.Item` renders `label` as the row text** (the row is `<Select.Item value="…" label="…" />` — no children); the `label` (not the children) is what bits shows in the trigger Value and matches for typeahead. Pass children only for a richer row, and keep `label` so the trigger/typeahead still read it.
    - **`Select.Root` needs an `items` (value/label) list.** Bits unmounts the Item components when the listbox closes, so without `items` the trigger Value falls back to the raw value after closing (the label is gone) and typeahead-while-closed + form autofill don't work. Pass the same list that backs the rows.
    - **Multiple value is normalised to `items` (list) order.** Bits appends to the value array in SELECTION order, so the trigger would join labels in pick order; Root re-presents it in list order via a pure `$derived` fed through the **function-form `bind:value`** (getter returns the reordered value, setter writes raw selections back — no write-in-`$effect`). The discriminated-union value (string vs string[]) can't be statically narrowed through a wrapper, hence the one `as never` getter cast.
    - **`allowDeselect` defaults to true** (bits ships it false): a single select returns to the empty/placeholder state by re-clicking the selected option (multiple ignores it). Required fields that must keep a value pass `allowDeselect={false}`. bits closes a single select on a NEW pick but not on deselect, so Root also closes it when the single value clears (via `bind:open` + the value setter) — every single-select pick (set or clear) closes consistently.
    - **The trigger's role is `button` + `aria-haspopup="listbox"`, NOT `combobox`** (combobox is the Tier-4 Combobox, a different bits primitive). Query it as a button in tests; the listbox/options use `listbox`/`option` with `aria-selected`.
    - **Content sizing rides inline `style` on the element, not the recipe:** the panel uses the GENERIC `min-width: var(--bits-floating-anchor-width)` and the viewport's `max-height: var(--bits-floating-available-height)` (not the `--bits-select-*` aliases) — Bits-owned variables, not `--mc-` tokens, so the components.css purity gate keeps them out of the recipe, and the generic names let the same `select-content` component serve Combobox too.
  - **Command (Tier 4) — the command palette:**
    - **A palette has no open/close of its own — host it in a Dialog** (the Cmd+K pattern): the Dialog supplies the trigger, focus trap, and dismissal on outside-click/Escape. Give `Dialog.Content` `class="overflow-hidden p-0"` + `showClose={false}` and the `Command.Root` `class="border-0 bg-transparent"` so the dialog chrome hosts a border-less palette edge-to-edge. (Testing the outside-click: the body has `pointer-events:none` while a dialog is open, so click the `.mc-dialog-overlay` scrim, not `document.body`.)
    - **The matcher is a seam:** `Command.Root` defaults to a plain case-insensitive substring match (value + keywords); pass `filter` to swap in a richer scorer or the firm search index. bits' own default is fuzzy (computeCommandScore).
    - **`Command.Empty` needs a `Command.Viewport`** inside `Command.List` — bits points the search Input's `aria-controls` at the Viewport node, and without it the combobox input fails axe's `aria-required-attr`. Structure: `List > Viewport > (Empty, Group > GroupHeading + GroupItems > Item)`.
    - **`Command.List` is keyed on `search === ""`** — bits re-creates the list node when the query crosses empty/non-empty, so a captured `within(listbox)` reference goes stale; query fresh after typing.
    - **Two axe tensions on a filterable listbox** (both inherent to the pattern, not defects): an EMPTY result set leaves the listbox with no `option` children (`aria-required-children`) — the "No results" message is the SR feedback, so leave showcase stories populated; and a SCROLLING command list driven by aria-activedescendant has no tabbable content (`scrollable-region-focusable`) — keep the showcase short/unbounded and bound height only where the run ends non-scrolling, or accept the documented exception. Command auto-highlights the first match as you type (assert that, not an ArrowDown to "first").
  - **Combobox (Tier 4) — the virtualized picker:**
    - **Reuses Select's listbox parts.** bits implements Combobox's Content/Item/Group/GroupHeading/Viewport/ScrollButtons with the SAME components as Select, so the Combobox index re-exports the Select wrappers (golden rule 1); only Root/Input/Content are Combobox-specific (Content differs only to avoid a scrolling Viewport — see virtualization).
    - **Filtering is consumer-controlled, and the input is DATA-SAFE.** bits' `inputValue` is non-bindable, has no change event, and is never reset on close — so typed-but-unchosen text would persist (bad data). The data-safe single-combobox pattern: the consumer owns the input text as `$state`, passes it as the controlled `inputValue`, updates it from the Input's `oninput` (this query also drives the `$derived` filter — what lets the list virtualize), sets it to the chosen label in `onValueChange`, and **resets it to the selected label (or empty) in `onOpenChange` when closing**. The value is then always one of the options. (A future single-select-combobox convenience could bake this in; for now it is the documented consumer pattern.)
    - **Root wires `aria-controls` itself.** bits' combobox Input sets `role="combobox"` + `aria-expanded` but NOT `aria-controls`, so `Combobox.Root` mints a listbox id (`$props.id()`) into context (`combobox/context.ts`); the Input consumes it for `aria-controls` and the Content uses it as the listbox element id.
    - **Virtualize with `internal/virtual-list` INSIDE `Combobox.Content`** — never a scrolling Viewport (it would fight virtua's own scroll). VirtualList wraps virtua's **`Virtualizer`** in its own `overflow-y-auto` container, so a `max-height` makes it FIT its content when there are few rows and cap + scroll + virtualize when there are many. **Hard-cap the visible rows** so the dropdown never stretches to the screen bottom: `style="max-height: min(var(--bits-floating-available-height, 18rem), 18rem)"` (≈8 rows; the cap value wants a token from the design-language workshop). The virtualized activedescendant listbox is the documented `scrollable-region-focusable` axe exception (disabled per-story with justification). A benign `ResizeObserver loop…` console message from virtua does not fail the test.
  - **Calendar / DatePicker / DateRangePicker (Tier 4) — the date family:**
    - **Values are `@internationalized/date` CalendarDate** (the civil date, ADR-0055) — never ZonedDateTime (the known weekday-shift bug). Calendar takes `type` ("single"/"multiple"); DatePicker holds one CalendarDate (NO `type` prop — passing one crashes the floating-layer render); DateRangePicker holds a `{ start, end }` range.
    - **Each is a self-contained component that bakes the grid composition** (Header with prev/next + month/year jump-to selects, weekday head keyed BY INDEX — narrow labels repeat S/T and collide string keys — and week rows of Day cells from the `months`/`weekdays` snippet). DatePicker/DateRangePicker reuse the `mc-calendar-*` recipes; the range day states (`data-range-start/middle/end`, `data-highlighted`) add to the day recipe.
    - **Month/year navigation is native `MonthSelect` + `YearSelect`** in the header (not a static Heading), so any month/year is one pick away — essential for far-back dates like a birthdate. They are native `<select>`s (need an `aria-label`); query them as `combobox` by name and assert with `getByDisplayValue`. The year list defaults to ±111 years and is bounded by `minValue`/`maxValue`.
    - **"No past dates" / "earliest date" is the `minValue`/`maxValue` setting** — it flows through all three (pass-through), blocks out-of-range dates (`data-disabled`, unselectable) AND floors/caps the year dropdown. No past dates → `minValue={today(getLocalTimeZone())}`; a birthdate floor → `minValue` of 1900 so pre-1900 (bad data) is never offered. `isDateDisabled` / `isDateUnavailable` block individual dates. (Stories pin fixed CalendarDates for VRT determinism — never `today()` in a test.)
    - **Two bits quirks:** the `Header` is a `<header>` banner landmark — neutralize it with `role="presentation"` (axe `landmark-banner-is-top-level`); and the prev/next buttons are labelled "Previous"/"Next" by bits (its props win), so query those names, not "Previous month".
    - **DatePicker.Content needs `DatePicker.Portal`; DateRangePicker.Content self-portals** (no Portal export) — match each component's bits exports.
    - **DateRangePicker: `closeOnRangeSelect` defaults false** (stays open to adjust) and supports **drag-to-select** — bits' range calendar is click-only, so we drive the bound `value` from the day's pointerdown→pointerenter (a drag spans different days, so no bits `click` fires for it and the two paths coexist; `<svelte:window onpointerup>` ends the drag). The in-range band keeps `text-default` (the endpoints' white must not bleed onto it).
    - **`pointerdown` resets the selection to the pressed day ONLY when a COMPLETE range already exists** (`value.start && value.end`) — so pressing a day clears the old range at once instead of it lingering until the pointer reaches another day (the owner's "only changes once I cover the other date" feel). It deliberately does NOT reset while a selection is in progress (start picked, end not), so bits' native click-a-start-then-click-an-end still works. Both paths are covered by the story's play test (click-click, drag, and press-resets-at-once).
    - **The selection's darker edge is a grey `border-strong` ring drawn with PER-SIDE borders** (token-pure — `box-shadow` offsets would need bare `0`/`calc(… * -1)`, which the components.css purity gate rejects; `border-block` + `border-inline-*` need none). The ring frames selected cells only, never the seams where selected days touch: each endpoint is **open on the band-facing side** (start = `border-inline-end-width: var(--mc-space-0)` + left-rounded; end = opposite), and a lone date (`start===end`) is a full rounded ring. **Today is a full rounded ring on a `transparent` background — the colour BEHIND it does the work.** A standalone today sits on the white surface; inside a range, the day's CELL is painted the band colour via `.mc-calendar-cell:has(.mc-calendar-day[data-today][data-range-middle])`, so the rounded ring reveals GREY at its corners and today reads as a seamless rounded ring IN the band — not square (the owner rejected square), not a white cut-out (the owner rejected the white box), and not a rounded grey square leaking the white surface at its corners. **Today is declared BEFORE the endpoints** and the endpoint rules zero their band-facing border, so an endpoint that is today still reads open. Owner-settled (2026-06-16, option "endpoint rings open to band" + grey-blended rounded today) over a pill-outline, a full-box-on-every-endpoint, and a white-cut-out alternative.
  - **Form field family (Tier 4, formsnap + superforms):**
    - **Field/Control/Fieldset/Legend/ElementField are re-exported from formsnap unchanged** (pure logic carrying the generic `SuperForm` typing + the name/id/aria/aria-describedby/aria-invalid wiring); only Label/FieldErrors/Description are styled wrappers. Compose `Field > Control({#snippet children({ props })} → <Label/> + our input `{...props}`) > Description > FieldErrors`. The field's vertical spacing is the `mc-form-field` wrapper recipe (Field renders no DOM).
    - **superforms needs SvelteKit's `$app/*`** (navigation/stores/environment/forms) which the plain-Vite Storybook lacks — stubbed in `.storybook/sveltekit-stubs/` and aliased in `.storybook/main.ts` (`viteFinal` resolve.alias). Any superforms-backed story relies on these.
    - **Story validates client-side** (`superForm(defaults(zod4(schema)), { SPA: true, validators: zod4(schema), validationMethod: "oninput" })`) so it shows errors without a server (avoids the enhance/submit path). Set `warnings.duplicateId: false` (the story renders more than once). Error text uses `--mc-status-danger` and passes axe contrast in the flagship theme (revisit per theme).
    - **The form-story submit path needs a real `$app/forms` enhance stub, not a no-op** — superforms drives submission through SvelteKit's `enhance`, so a no-op lets the native submit navigate (a 404 in the catalog). The stub (`sveltekit-stubs/forms.ts`) mirrors enough of the enhance contract — `preventDefault`, hand superforms the submit params, stop on `cancel` (SPA mode always cancels after validating) — so submit validates in place with no fetch.
    - **Email-TLD validation uses the `tlds` package (the IANA root zone), not a hand-written set** — the address shape is a regex; the ending is checked against `new Set(tlds)` so a real-but-short (`.c`) or plausible-but-fake (`.zz`) TLD is rejected, only existing TLDs pass. `tlds` is pinned in the catalog and is **the same list the app's real form schemas import**, so there is one auto-published source to track. `psl` (public-suffix list) is the wrong tool here — it parses registrable domains (eTLD+1), a different question than "is this a valid TLD"; adopt it only if a real registrable-domain feature appears. The story's schema is a UI demo; the authoritative validator lives with the app's form slice (and reuses `tlds`).
  - **Future component families (owner-flagged 2026-06-13), beyond the Tier 3/4 plan:**
    - **Slider** (Inputs, Tier 3) — a value control on bits-ui Slider; value-driven fill like Progress.
    - **DropdownMenu / ContextMenu** (Overlays, Tier 3) — menus of actions on bits-ui Menu/ContextMenu; floating (the floating module) and likely the FIRST scroll-locking floats, so the CSP scroll-lock `pnpm patch` lands here.
    - **AI components** (new domain family, later — more complex): streaming-response surfaces + status indicators (token streaming, tool-call status, stop/regenerate). A richer composite; design separately when AI features land, likely its own catalog category.
  - **Status surfaces use the gated solid pairing:** an Alert is a solid `status.<v>` panel with `status.<v>-foreground` (the AA-gated pair); a status colour as **text on a light surface is ungated and can fail AA** — do not use it until `status.*-subtle` tokens exist.
  - **Animations pulse between token colours, not opacity** (no opacity token; opacity literals are banned) and carry a `prefers-reduced-motion` guard (Skeleton).
    - **Future evaluation — auto-generated skeletons** (owner-flagged 2026-06-13): the in-house Skeleton is hand-placed, so its shape can drift from the real component. [phantom-ui](https://github.com/Aejkatappaja/phantom-ui) auto-generates shimmer placeholders by measuring the real DOM at runtime (a framework-agnostic Lit web component). Appealing for drift, but a poor foundation fit as-is — it injects non-token styling (vs golden rule 2), is a brand-new single-author dep bundling Lit (bus-factor), and adds runtime measuring + a CSP surface to vet. If skeleton drift becomes real pain across many components, spike it properly (adopt, or borrow the measuring-wrapper idea in-house with token-driven shimmer). Not for 0·7a.
- **Catalog model (owner-settled): one story per variant/instance; autodocs is the review surface.**
  - **Catalog taxonomy (owner-settled 2026-06-13): semantic categories as the story-title prefix, NOT a flat `Components/*`.** A story's `title` is `<Category>/<Component>`. Categories: **Inputs** (Input, Textarea, FileInput, Label, Checkbox, Switch, RadioGroup, + future Select/Slider), **Compound Inputs** (composed/specialized data entry — the dedicated-components list above), **Actions** (Button), **Data Display** (Badge, Card, Keyboard, Avatar), **Feedback** (Alert, Skeleton, Progress, Tooltip), **Layout** (Separator, Tabs, Accordion), **Overlays** (future — Dialog, Popover, DropdownMenu, ContextMenu), **Foundations** (the Design Tokens board). Established while the catalog was small and no VRT baselines were committed (re-titling changes story IDs, so it's cheapest before baselines exist). New components pick the matching category.
    - **Inputs vs Actions — the delineation** (owner question 2026-06-13): an **Input holds a VALUE** the user sets and a form reads (checked/selected/typed) — Checkbox/Switch/RadioGroup/Input/Select/Slider, even though they're "interactive", are Inputs because their job is state. An **Action triggers a one-shot operation** and holds no value — Button (and menu items). Test: "does it carry a value, or fire a command?" Menus (DropdownMenu/ContextMenu) are overlays OF actions → **Overlays**.
  - **One story per the component's main "variant" axis** (Button per variant; Alert/Badge per variant; Separator per orientation); a component with no variant axis is ONE story (Textarea, FileInput, Card, Label, Skeleton, Keyboard). **Every OTHER prop is a Control, not a story** — `size`, `disabled`, `href`, `placeholder` are toggled in the Controls panel, never enumerated as stories.
  - **Input is the deliberate exception — one story per `type`** (owner-settled 2026-06-13): the text-like types are not interchangeable, each carrying its own validation rules, mobile input-mode/keyboard, and autofill semantics (so `text`/`email`/`tel`/`url` differ even though their resting box looks alike). Each type's story sets the attributes that make it meaningful (e.g. `number` min/max/step, `tel` inputmode, email/url showing constraint validation), and `type` stays a `control: "select"` so any type is still toggleable. This is the one place `type` is enumerated rather than left a Control.
  - **No separate Playground** — the **first story IS the Docs-page Primary**, and autodocs wires the **Controls** panel to it.
  - **ALL controls live in the docgen "Properties" group — declare controllable props on the COMPONENT, not in story argTypes.** A prop defined only in a story's `argTypes` that has no matching component prop renders in a SEPARATE group that floats above "Properties" (the docgen group; its name is not settable, so you cannot merge into it via `table.category`). So commonly-controlled native attributes (`disabled`, `href`, `placeholder`) are declared EXPLICITLY on the component with a **JSDoc comment** (docgen reads it for the description) instead of being left to the `...restProps` spread — then they appear under "Properties" with descriptions, no floating, no extra category. Story `argTypes` are used ONLY to give enum props (`variant`, `size`, `orientation`) their explicit `control: "select"` + `options` (those props are already on the component, so they stay in "Properties").
  - **Bits-UI (Tier 2+) components MUST whitelist controls — `parameters.controls.include`.** Bits' prop types resolve to `Without<BitsPrimitive…Attributes, …>` mapped types that **materialize every HTML attribute** (`aria-*`, `data-*`, all `on*` handlers, the global attributes), and docgen turns each into a control — Tabs.Root showed **439** rows before the whitelist, 5 after. (Native Tier 1 wrappers don't hit this: svelte docgen leaves an imported `HTMLXAttributes` opaque, so Input shows ~5 with no whitelist.) So every Bits story sets `parameters: { controls: { include: [the meaningful props] } }` and uses `argTypes` to give its enum props `control: "select"`. The whitelist also trims the autodocs "Properties" table.
  - **Consolidated controls system — ONE rule, applied to EVERY story (do not deviate per-component):**
    1. **`args` holds ONLY the component's declared props** (the real API — they land in the "Properties" group). **Per-instance attributes go in the TEMPLATE, never `args`** — the accessible name (`aria-label`), a number field's `min`/`max`/`step`, etc. An undeclared attribute placed in `args` renders as a control FLOATING above "Properties" (ungrouped) — that's the bug to avoid (Input's per-type stories regressed this with `aria-label`/`min`/`max` in args; fixed by moving them to the template).
    2. **`ref` is hidden globally** (`preview.ts` `controls.exclude: ["ref"]`) — it's the bindable element reference, not a configurable prop.
    3. **Properties are alpha-sorted globally** (`preview.ts` `controls.sort: "alpha"`) — svelte-docgen's own order is non-deterministic across components, so force one order. (preview-config changes need a Storybook RESTART to re-bake the docs blocks, not just HMR.)
    4. **A prop Bits owns at mount is NOT a live control** — `value` (Tabs/RadioGroup), `type` (Accordion) don't switch behaviour when edited live, so they're the **variant axis (one story per value)** or a fixed per-story arg, never a misleading control. Two-way-bound state (`checked` via `bind:checked`) IS live and stays a control.
  - **autodocs is on** (`tags: ["autodocs"]` in `preview.ts`; `@storybook/addon-docs`): each component's **Docs page is the single review surface** — description → controllable Primary + Controls → the auto "Properties" table → every instance as its own labelled block. Storybook cannot auto-generate a variant matrix from types; the per-instance stories ARE the showcase.
  - **Behaviour not visible on a showcase story rides a hidden test-only story** tagged `["!dev", "!autodocs"]` — it runs in the test addon but is absent from the sidebar and the Docs page (Button's `Behaviour` story tests submit-proof type, disabled-blocks-click, and href→anchor, none of which a variant story shows). Where the behaviour IS on a visible instance story (Alert role, Input typed/disabled, Label focus), keep the assertion there.
  - **Every `play` wraps its assertions in named `step()` calls** (the play context's `step`, no import) — one step per beat (`"Starts unchecked"` → `"Clicking checks it"`). The play functions ARE the behaviour tests, but a bare list of `expect(...)` lines reads as noise in the Interactions panel; `step()` turns each into a labelled, collapsible checklist that doubles as living documentation of what the component guarantees. Keep element lookups above the steps; put each interaction + its assertions inside the step it proves. (Owner-directed 2026-06-13 — the panel must read as a checklist, not a wall of assertions.)
  - **Never two stories rendering the SAME thing** (duplicates stack on the Docs page — the owner saw "two cards on top of each other").
  - **Visual-tests addon** (`@chromatic-com/storybook`) is installed but **inert** until a Chromatic token is set; the recorded primary VRT is the self-hosted Playwright harness (Argos the named upgrade) — revisit which SaaS before relying on Chromatic.
- **`ContextMenu.GroupHeading` outside a `ContextMenu.Group` stops the menu OPENING, silently.** No
  console error, no failed render, no thrown exception a caller can see — the right-click simply does
  nothing, which reads as "context menus do not work here" and sends you looking at the trigger. A
  heading that names no group has no group to name: either wrap the items in `ContextMenu.Group`, or
  use the plain heading element the other menus use (`<p class="mc-table-filter-heading">`), which is
  what the grid's column filter menus do. Found the hard way, 2026-09-02.
- **`#NNNN` issue references in `src/` comments trip the raw-hex gate** (four hex digits) — cite
  issues in full URL form or use a justified `fitness-allow`.
- **No-emoji gate (golden rule 2)** is the fifth off-token scanner (`test/fitness/off-token.test.ts`):
  it bans the pictographic ranges (emoji planes U+1F000–1FAFF and Misc Symbols U+2600–26FF, where an
  emoji's base always falls) across the UI source sweep. Text symbols the codebase uses in comments —
  arrows (→ ↔) and the dingbat ✕ — are deliberately NOT banned. Docs + commit messages are
  golden-rule-2 surfaces too, enforced outside this UI-source sweep (review + commit hooks).
- **z-order (decided 2026-07-03):** anchor-positioned floating content (select/combobox
  listboxes, menus, popovers, tooltips) rides the `anchored` layer (1350) — ABOVE `modal`
  (1300), below `toast` — because a picker opened from inside a dialog painted beneath the
  panel at the old `dropdown` layer (visible but pointer-blocked; the Radix/Bits ecosystem norm
  is anchored content above dialogs). `dropdown` (1000, below `sticky`) remains for
  non-anchored dropdown-like surfaces that should scroll under pinned bars. One home:
  `internal/floating.ts`; ordering pinned by `test/floating.test.ts`.
- **Workshop agenda (hairline weight under fractional DPR) — flagged for Fable design review:**
  the horizontal and vertical Separator can look unequal in weight even though both are correctly
  `1px` (`--mc-border-width-default`) — horizontal sets `block-size`, vertical `inline-size`, same
  token. This is **not a code defect**: at a fractional `devicePixelRatio` (e.g. 1.5 / Windows 150%
  scaling) a 1px hairline is sub-device-pixel, so its painted weight depends on where the _parent
  layout_ places it. Measured in the catalog at DPR 1.5: the horizontal rule landed on an integer
  device-pixel boundary (`top 76px → 114.0`) → crisp, full-strength row; the vertical rule landed on
  a fractional boundary (`left 55.24px → 82.86`) → antialiased across columns at partial opacity →
  reads thinner/lighter. The effect is positional and shifts with scaling and surrounding content;
  it converges at integer DPR (100% / 200%). A component-level fix can't reliably solve it (position
  is the consumer layout's, not the separator's). Open decision for Fable: accept as an
  environmental hairline artifact, or adopt a device-pixel-snapping hairline technique
  system-wide — deliberate, not a quick patch.
- **Sidebar collapse seam tearing — RESOLVED (owner-flagged "not acceptable"; fixed via View Transitions).**
  The collapse used to animate **layout** properties (the rail `inline-size`, the menu-button
  `grid-template-columns` `1fr→0fr`, the label `padding`), repainting the sidebar↔canvas seam every
  frame; at a fractional device-pixel ratio (Windows 150% scaling) that 1px border edge shimmered/tore.
  Profiling showed it was **not** a frame-rate problem (avg ~16.7ms/frame, 0 long frames) — purely the
  sub-pixel **paint seam**. Fix: the collapsed-state widths/tracks now change **instantly** and the
  collapse is composited via the **View Transitions API** — the Trigger flips state through
  `runViewTransition` (`internal/view-transition.ts`), `.mc-sidebar` carries `view-transition-name:
mc-sidebar`, and the work canvas (in the shell/story) carries `view-transition-name: mc-app-canvas` so
  it morphs rather than ghosting. The browser tweens before/after layouts on the GPU, so the seam is
  sampled, never re-rasterized → no tear. Reduced-motion / unsupported browsers fall back to an instant
  collapse. **The UX principle this establishes platform-wide: animate only compositor properties
  (`transform`, `opacity`) — never `width`/`height`/`grid-template`/`top`/`left`/`margin`; for an
  unavoidable layout change, wrap the mutation in `runViewTransition`.** Chosen over a hand-rolled
  `translateX`/spacer rebuild because View Transitions is the project's motion stack (Svelte built-ins +
  View Transitions at 0 kB) and far less invasive. Only collapse-unrelated interaction colour
  (hover/active) still uses CSS transitions. (Play test asserts the now-deferred state flip via
  `waitFor`.)
