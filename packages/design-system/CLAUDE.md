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
- `src/lib/components/calendar-grid/` — `CalendarGrid` (Month, Week, Day, Agenda): the domain-free
  presentations on the EventRail division — entries with a civil day, a label, a caller-formatted
  time and a tone come in, and it never learns what a hearing is. **Two of the four are TIME
  GRIDS** — the Day, whose columns are the calendars a reader turned on, and the Week, whose columns
  are its seven days: an hour is a row, and a timed entry is a BLOCK from its start to its end
  rather than a chip parked in its starting hour (owner ruling, 2026-09-14). The block sits in the
  DOM cell of the hour it begins in, which is where a screen reader should meet it, and is
  positioned out of that cell over the hour step (`--mc-calendar-grid-hour-size`), so it overflows
  downwards for as long as it runs. Two pure modules carry the arithmetic and are tested without a
  browser: `time-placement.ts` (the span an entry occupies, floored at `MINIMUM_BLOCK_MINUTES` so a
  fifteen-minute call can still hold its label, and the share of the column it takes) and
  `time-blocks.ts` (which cell it renders in, and the inline style that draws it), and
  `day-segments.ts` (the timed entries a day's axis holds: the ones that begin and end on it).
  **A run of days reads in the band above the hours, never on the axis** (`inAllDayBand`,
  `day-axis.ts`; owner, 2026-09-18): a Monday-to-Wednesday trial spans the band the way it spans
  the month, with its hours on the chip as text. It used to be cut into a piece per day — the start
  hour to midnight, a whole column, midnight to the end — which drew it as three full columns and,
  where the day drew only working hours, as blocks reaching above and below the grid. A span's hours
  never widen the axis either. **How concurrent
  entries are drawn is the READER's** (`concurrency`: `side-by-side` divides the column,
  `overlap` steps them over one another) — a closed set, never a length or a flag at a call site.
  The month and the agenda have no hour axis and take no such prop. The calendar's own arithmetic,
  reads and vocabulary live with its one consumer, `apps/web/src/lib/calendar/`
- `src/lib/components/address-fields/` — `AddressFields`, the product's ONE address form. Its shape
  is the country's (`address-format.ts`), not the platform's; see the Compound Inputs note below for
  the three rules it keeps. Domain-blind: it takes the parts, the countries to offer and — optionally —
  the constraints and an address lookup, and knows nothing about whose address it is — what an address is FOR (its use, whether the place physically
  exists) belongs to the consumer
- `src/lib/components/action-dialog/` — `ActionDialog`, the one panel an act is asked for in;
  `action-dialog-model.ts` holds the kind table (what each kind implies) as data, not `{#if}`
- `src/lib/components/permission-request/` — `PermissionRequest`, the one window any feature asks
  a member for a permission in. It is an `ActionDialog` of kind `confirm` and takes three things:
  the heading, who is asking, and the list of what is granted. It has no prop for what is NOT
  granted, for a description, or for a warning, and gains none: the owner ruled that a permission
  request states only what it grants
- `src/lib/components/record-reference/` — what a modal's SUBTITLE is allowed to say. `types.ts` is
  the contract (`RecordSubject` = an optional `RecordReference` plus short facts; a reference is
  `kind`, `number` and a standing of `drawn | tentative | draft`), `record-reference-model.ts` is
  the table that resolves a reference to what it reads as, `record-subject.svelte` renders the line
  (a draft number in italics, the product's one format for it), and `draft-number.svelte.ts` holds
  the draft number a record being created will be saved under — held for the panel, renewed while it
  is open, given back on cancel, with a ticket that stops a stale answer landing on a newer one. It
  takes a keeper that holds and releases, so the app's transport and failure model stay in the app. EntityIdentity names
  a PERSON OR ORGANIZATION from elsewhere; this names the RECORD a panel is acting on, by the number
  somebody quotes. Asserted at the call sites by `pnpm run lint:modal-headers`
- `src/lib/components/dropdown-menu/hover-open.ts` — the hover activation every DropdownMenu gets:
  the timing, the focus rules, and the one-hover-menu-at-a-time arbitration, shared from Root to
  Trigger/Content/SubContent through context (`openOnHover={false}` on Root keeps a menu click-only).
  A trigger with no words, a "..." or any icon-only button, never opens on hover (owner ruling
  2026-11-13); the Trigger checks its own text at the moment of the hover
- `src/lib/components/conversation/` — `Conversation`, the transcript surface the assistant is read
  through. It is a RECORD, not a chat window: no bubbles, no avatars, no coloured alignment, no
  motion. A turn is a speaker label over a body, hairline-separated, and the two speakers are told
  apart by label and weight rather than by being pushed to opposite sides. It holds no copy — every
  word, the speaker labels included, comes from the caller — and a `state="pending"` turn draws no
  shimmer, spinner or skeleton, because loading here is `LoadingRegion` and nothing else
- `src/lib/components/loading-region/` — `LoadingRegion`, the ONE loading state: real markup over a
  fixture, greyed by the `mc-loading` recipe (imported last in `components.css`, on purpose)
- `src/lib/components/qr-code/` — `QrCode`, a value drawn as a symbol a phone camera reads (the
  two-factor secret). Encoded by `uqr` into a module matrix and drawn as ONE SVG path by the pure
  `qr-code-model.ts`. It is inked in the chrome pair — `chrome-surface` on `chrome-text-strong` —
  because that is the one token pair that does not turn over in dark mode, and a scanner wants dark
  modules on a light field in every mode. A caller always shows the value as text beside it too
- `src/lib/styles/components.css` — the semantic component-class layer (`mc-*` recipes)
- `src/stories/**.stories.svelte` — the catalog; stories triple as browser-mode behavior tests and
  per-story axe checks
- `.storybook/` — catalog config; `catalog-matrix.ts` is the single theme/mode list
- `test/fitness/` — the golden-rule-2 gates (off-token, boundaries, components.css purity)
- `test/csp-spike/` — the CSP probe + `VERDICT.md` (re-runnable; asserts the verdict)
- `visual-regression/` — Playwright screenshots over the static Storybook build, theme×mode

## The formatters

How a value reads, and the one place that decides: [`src/lib/formatters/CLAUDE.md`](src/lib/formatters/CLAUDE.md). Never elapsed time; civil dates pin to UTC; instants render in the viewer's zone.

## Two modal shells, and never a third

`ActionDialog` and `RecordWindow` are the only modal shells, on one shared frame. Their rules: [`src/lib/components/record-window/CLAUDE.md`](src/lib/components/record-window/CLAUDE.md).

## Component families

Each family's rules sit beside its code and load when you work there:

- Directory linking (one mark, one field, one tab): [`src/lib/components/entity-picker/CLAUDE.md`](src/lib/components/entity-picker/CLAUDE.md)
- The table's own controls, the grid's frame, scale and row marks: [`src/lib/components/data-table/CLAUDE.md`](src/lib/components/data-table/CLAUDE.md)
- History (undo and redo): [`src/lib/components/history/CLAUDE.md`](src/lib/components/history/CLAUDE.md)
- Drag: [`src/lib/components/item-drag/CLAUDE.md`](src/lib/components/item-drag/CLAUDE.md)
- Maturity and the field primitives: [`src/lib/components/maturity/CLAUDE.md`](src/lib/components/maturity/CLAUDE.md)
- The sidebar: [`src/lib/components/sidebar/CLAUDE.md`](src/lib/components/sidebar/CLAUDE.md)
- The navigation layout: [`src/lib/components/navigation-layout/CLAUDE.md`](src/lib/components/navigation-layout/CLAUDE.md)
- How components are built (wrappers, naming, focus, disabled, per-component bits-ui quirks): [`src/lib/components/CLAUDE.md`](src/lib/components/CLAUDE.md)
- The Storybook catalog model: [`src/stories/CLAUDE.md`](src/stories/CLAUDE.md)

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
  lazy-imports `@vitest/coverage-v8`, which isn't installed. Vite+ now runs upstream Vitest (the
  catalog `vitest` pin equals the version vite-plus depends on), so no fork stands in the way: to
  enable, add `@vitest/coverage-v8` at that same version to the catalog + root devDeps, install,
  and confirm coverage runs.
- **Node 25 ships a dead `localStorage` global that happy-dom cannot replace** — stub storage via
  `vi.stubGlobal` (see `theme-preference.test.ts`).
- **CSP (`test/csp-spike/VERDICT.md`):** Floating UI positioning is CSP-clean; Bits' scroll-lock
  RESTORE used `setAttribute("style", …)`, which strict `style-src` blocks. That was patched locally
  until upstream fixed it: as of 2.20.6 Bits restores the body through `style.setProperty` /
  `removeProperty` (CSSOM), so the scroll-lock half of `patches/bits-ui@2.20.6.patch` is gone. Never
  loosen `style-src` instead. The spike asserts the CSP-clean verdict and fails if a bits-ui upgrade
  regresses it — re-run on every bits-ui/svelte bump (`tools/run-csp-spike.cmd`).
- **The patch makes `onFocusOutside` preventable.** A focus event is not cancelable, so the
  `event.preventDefault()` Bits documents as the way to keep a layer open on focus leaving was a
  no-op and Bits closed the layer anyway — a submenu hosting a DatePicker closed the moment its
  calendar took focus. The patch wraps the focus event the way Bits already wraps a pointer event,
  so the prevented state is tracked; `context-menu/menu-field-layer.ts` relies on it. Re-check it
  on every bits-ui bump; upstream still passes the raw event as of 2.20.6.
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
- **Building a component** (wrappers, naming, focus, disabled, Select / Command / Combobox / date / form quirks): [`src/lib/components/CLAUDE.md`](src/lib/components/CLAUDE.md).
- **The catalog model** (one story per variant, controls, autodocs, `step()`): [`src/stories/CLAUDE.md`](src/stories/CLAUDE.md).
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
  is anchored content above dialogs). **Every floating Content part takes `anchored`** — the two
  context-menu parts were the last on `dropdown`, and a right-click menu raised inside the Upload
  dialog painted under the panel, there and unreachable (corrected 2026-09-11; the ContextMenu
  story "Inside a dialog" pins it). `dropdown` (1000, below `sticky`) stays a token for a
  non-portaled surface that should scroll under pinned bars; no floating part may name it, and
  `test/floating-surfaces.test.ts` refuses one. One home: `internal/floating.ts`; ordering pinned
  by `test/floating.test.ts`.
- **Where a surface opens, and how wide it may grow, is the component's — never the call site's
  (owner ruling, settings round 2026-09-11).** Select, Combobox, DropdownMenu and Popover Content
  all default to `align={FLOATING_ALIGN}` (`"end"`: the panel's end edge on the control's, growing
  toward the start — most controls that open one sit at the right of a row or a bar), hold
  `FLOATING_COLLISION_PADDING` off the viewport, and cap their width to
  `--bits-floating-available-width` (`FLOATING_PANEL_STYLE`; the listboxes also floor it at the
  anchor width, `LISTBOX_PANEL_STYLE`), so a long option wraps inside the panel instead of running
  it off the screen. All four constants live in `internal/floating.ts`; `test/floating-surfaces.test.ts`
  pins every part to them. A caller's explicit `align="start"` (a filter at the start of a
  toolbar) still wins, and a caller's `style` is composed AFTER the panel's own through
  `floatingContentStyle()` — never spread over it, or the width rules vanish. The ninety-five
  hand-written `align="end"` in `apps/web` are now redundant and harmless. A context menu is NOT
  one of these: it anchors to the pointer and keeps Bits' start alignment. **The Combobox anchors
  to the field box, not the input:** Bits anchors a combobox to the `<input>` alone, which sits
  inside the bordered field and short of the chevron, so Root shares the field box through
  `COMBOBOX_FIELD_ANCHOR`, Input fills it, and Content uses it unless a caller passes
  `customAnchor`. What the end alignment cannot promise: a panel wider than the room to the START
  of a left-anchored control has nowhere to go but rightward, and Bits' shift puts it on screen
  there rather than off it.
- **Animate compositor properties only**; the sidebar collapse is the worked example: [`src/lib/components/sidebar/CLAUDE.md`](src/lib/components/sidebar/CLAUDE.md).
