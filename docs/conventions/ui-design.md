# UI & design conventions

**Scope (single home for):** how UI is built so it stays consistent — design-token usage, theming, icon usage, component composition, the catalog/testing definition-of-done, and the rules that keep CSS from drifting. This is the **practitioner's how-to**; the rationale and the decision live in the [white paper](../Magna-Carta-White-Paper.md) (_Design system, UI consistency & design quality_) and **ADR-0076**. The owner's standing design rulings — corrections already issued, which every new surface inherits — live in [`design-corrections.md`](design-corrections.md); read that before composing a screen. The two packages it governs each carry a local `CLAUDE.md` with the accumulated gotchas — read those when working in-area: [`packages/design-tokens/CLAUDE.md`](../../packages/design-tokens/CLAUDE.md), [`packages/design-system/CLAUDE.md`](../../packages/design-system/CLAUDE.md).

The whole system enforces **golden rule 2** — _all UI through the design system_ — and most of it is **machine-checked**, so "follow the convention" mostly means "make the gates pass."

## Working model — orchestrate, don't implement inline

**All UI design and implementation work is delegated to subagents; the main Claude instance in a UI stream stays an orchestrator** (owner-directed, 2026-07-02). The coordinator's context is spent on the things only a coordinator can do — sequencing the work, empirical browser verification of what agents built, design review against the owner's corrections, running the gates, and committing — never on writing component code inline. The working rules that make this safe:

- **Strict per-agent file ownership.** Each subagent receives an explicit list of files it owns for the task; two agents never touch the same file in the same round. The coordinator resolves any file that genuinely needs two hands by sequencing, not sharing.
- **The two agent definitions carry the constraints.** `.claude/agents/ui-builder.md` and `.claude/agents/design-reviewer.md` hold the binding rules and the reading order, so a delegation prompt names the task rather than restating the standard. Extend the agent when a rule changes; do not fork the rules into a prompt.
- **One browser.** Browser verification runs in one place — the coordinator's session (or one designated agent) — so screenshots, computed styles, and interaction tests never race each other.
- **The coordinator verifies empirically before committing.** An agent's "done" is a claim; the coordinator confirms it in the running app (screenshots, computed styles, interaction round-trips) before the round's gates and commit.
- **Agents get the constraints, not just the task.** Every delegation prompt carries the binding rules for the files in play (token purity, no emojis, full names, the relevant recipes and gotchas from the area `CLAUDE.md`s) so the gates pass on the first round, not after rework.
- **Sessions die; transcripts persist.** A killed or interrupted agent is resumed by continuing the same agent with a precise finish list (inventory the on-disk state first), not by re-delegating from scratch.

## The four layers

1. **`@magna-carta/design-tokens`** — the single source of design truth. Spec-pure DTCG 2025.10 token source → Terrazzo generates committed CSS custom properties (`--mc-*`) per theme×mode plus the Tailwind v4 `@theme`.
2. **`@magna-carta/design-system`** — the styled component layer: headless **Bits UI v2** primitives dressed by `mc-*` recipe classes fed _only_ by token variables. The only place UI primitives are defined and styled.
3. **The catalog** — Storybook 10; every component ships a story that triples as a behaviour test (Vitest browser mode) and an axe check, and joins the visual-regression matrix.
4. **The fitness gates** — Vitest scans that reject off-token values, raw colors, raw z/duration numerals, emojis, `bits-ui` imports outside the package, and bare Lucide imports.

## Tokens — adding or changing one

Never hand-edit `packages/design-tokens/generated/**` (CI regenerates and diffs — the drift gate). Edit the **source** under `tokens/`, then rebuild and re-pin.

- **A new semantic color or a theme tweak** → edit `tokens/semantic.json` (light/default truth, aliases only) and/or the mode overlay / theme files; the completeness gate requires every theme×mode context to resolve every semantic token, and the **WCAG 2.2 contrast gate** requires every declared foreground/background pair (`src/contrast-pairs.ts`) to clear AA in every context. A new pair → add it to `contrast-pairs.ts`.
- **A new theme** → run the Culori generation script (`scripts/generate-theme.ts` — anchor hue/chroma/neutral-tint → gamut-mapped OKLCH ramps with generation-time contrast validation), add the resolver context + the terrazzo `themes` entry, and add the one `catalog-matrix.ts` row so the catalog + VRT cover it. Themes swap ramp _values_ only; structure stays in the shared mode overlay.
- **A length a recipe needs but no token provides** → add the dimension token (the `focus-ring` width/offset, the `border-width.default` hairline, and the `size.sidebar`/`-rail` widths all exist for exactly this reason), regenerate, and **re-pin the golden snapshot in the same commit**. Do _not_ reach for a literal or a bare keyword like `thin`.
- After any token change: `pnpm --filter @magna-carta/design-tokens build`, copy `generated/*.css` into `test/golden/`, and run the package gates (purity / completeness / contrast / golden / generator).

## Tailwind v4 + the recipe layer

- Utilities consume only the generated `@theme` (`--spacing-*`, `--color-*`, `--radius-*`, …). **What the gates reject:** arbitrary values (`p-[13px]`, `bg-[#fff]`, `duration-[150ms]`), raw color literals, raw `z-<number>`, raw `duration-<number>`, and emojis. `data-[state=…]`/`aria-[…]` **variants** are allowed (they select state, carry no value) — that's how presence animations are written.
- **`components.css` is token-only, no escape valve:** every declaration value is a `var(--mc-…)` reference or a structural keyword (`flex`, `solid`, `inherit`, `none`, …). No literal colors, lengths, durations, or numbers — not even a bare `0` (`var(--mc-space-0)`), `calc()`, or `%`. **Layout width/height is a utility on the element** (`w-full`/`h-full`), never a `%` in the recipe; the recipe owns visual design only.
- **A size utility off the generated scale produces NOTHING, and nothing says so.** The spacing scale is `0 4 8 12 16 20 24 32 40 48 64 96` (`packages/design-tokens/generated/tailwind-theme.css`), so `w-160` / `w-192` / `h-80` compile to no rule at all: the element silently keeps whatever width it already had, which for every `Input` is the `w-full` baked into the component. Nothing fails — not the arbitrary-value gate (the class is not arbitrary), not the type-checker, not a test. Two matter surfaces shipped a search field and a date field that were meant to be narrow and were full-bleed. Size against the scale, use Tailwind's container widths (`w-xs`, `w-3xs`) for anything wider, or lay the row out with `grid`/`flex` so no width literal is needed.
- **An element that can scroll names a scrollbar recipe.** `mc-scrollbar`, or `mc-scrollbar-hidden` with a `ScrollEdgeHint` where a scrollbar appearing would reflow the strip it sits in — otherwise the region wears the operating system's, which only shows on real data. It binds when the overflow comes from a recipe as much as from a utility (`.mc-modal-frame-pane` scrolls in CSS), and `pnpm run lint:scrollbar` derives which classes those are from the stylesheets themselves. The rule is in [`design-corrections.md`](design-corrections.md) under _Lists and tables_.
- **A settings page has ONE scroll region, and it is `SettingsScrollRegion`.** Wearing the right scrollbar is not enough when a page nests a second region inside its first — Settings › Numbering shipped with two bars because the design system's table brought its own — so `pnpm run lint:settings-scroll` walks what every settings route renders and fails on any scroll region but that one, standing allowances printed as debt on each run. The rule is in [`design-corrections.md`](design-corrections.md) under _Settings_.
- New generated token namespace → register it in `merge-classes.ts` or conflicting utilities silently both survive (named duration/z scales need `extend.classGroups`). Z-index and presence animation live in `internal/floating.ts` only.

## Building a component (the loop every component follows)

The exemplars are normative — Button (Tier 1, native), Tabs (Tier 2, single Bits primitive), Dialog (Tier 3, portal/floating), Select (Tier 4, composition-heavy). A sibling repeats the loop against _its own_ Bits doc page; never copy an exemplar's attribute names blind.

1. **Read the current Bits UI doc page** for the component (parts, `data-*` attributes, CSS variables, snippet props) — golden rule 11, build against the live API.
2. **Story first** (`src/stories/<name>.stories.svelte`, svelte-csf v5): one story per the component's variant axis, every other prop a Control. Cover each state; `play` assertions are the behaviour tests, wrapped in named `step()` calls so the Interactions panel reads as a checklist.
3. **Run the story tests — they fail.**
4. **Implement the wrapper(s) + the `mc-*` recipe** (token vars only). The idioms:
   - **Single native element** → `WithElementRef<HTMLXAttributes, HTMLXElement>` + `mergeClasses("mc-x", className)`. Variant components add a plain typed `variants.ts` record (no DSL).
   - **Bits wrapper** → thin part files: `<Primitive.Part bind:ref class={mergeClasses("mc-x", className)} {...restProps} />`, recipes targeting `.mc-x[data-state="…"]`.
   - **Floating (Tier 3/4)** → the two-level rule: outer `wrapperProps` element unstyled (Floating UI positioning), inner styled via `floatingContentClasses()`; z via the token map.
   - **Adapter-backed (DataTable)** → keep the third-party API (`@tanstack/table-core`) the contract; the styled primitives are presentation, the adapter is the seam.
   - **Multi-part** → an index exporting the **house namespace shape**: bare names (`Root`, `Header`, …) plus prefixed aliases (`Card`, `CardHeader`, …).
   - **`href`-or-`button`** → a relaxed button/anchor **intersection** with `href`/`type`/`disabled` pulled out (a discriminated union explodes svelte-check); see Button / Sidebar.MenuButton.
   - **Controlled state from a single source of truth** → when a stateful primitive (a Checkbox tracking external selection, a Switch, a faceted list) is driven by app/table state, bind it with **get/set function bindings** — `bind:checked={() => isSelected(value), (on) => setSelected(value, on)}` — not one-way `checked={…}` + `onChange`. One-way control lets the Bits primitive keep an internal value that drifts from the source whenever a programmatic change leaves the controlling expression's value unchanged (e.g. an empty-array filter that the data layer drops), so the box shows checked while state says unchecked. Function bindings make the rendered state _always_ re-read the source. See `DataTable.ColumnFilter` and the matters-table selection checkboxes.
   - **Derive options from a stable source, not a filtered one** → a control that lets you _narrow_ a set (a faceted checklist, a token picker) must build its option universe from the **unfiltered** data, never from the post-filter view — otherwise options vanish as the selection narrows and "select all / none" math divides by a shrinking set (the faceted-filter inversion bug: `getFacetedUniqueValues()` empties when the column filters to nothing, so `0 === 0` read as "all"). Keep the selection model pure and unit-test it (`facet-selection.ts`); the component just renders it.
5. **Per-story axe passes** (`a11y.test = "error"` — violations fail). Preserve accessible names: a label hidden in a collapsed rail goes `sr-only`, never `display:none`.
6. **Regenerate VRT baselines in the pinned container** and confirm the diff is only the new component (see _Visual regression_).
7. **Commit** `feat(design-system): <component>`.

**Naming** (owner-settled): components are PascalCase; a single-element wrapper takes the element's own spelling (`Input`, `Textarea`, `Label`); a compound/multi-part set is PascalCase per word (`FileInput`, `RadioGroup`). The recipe class is the kebab-case of the component name (`mc-file-input`). Spell names in full — golden rule 12 (`Keyboard`, not `Kbd`).

## Icons

Lucide only, **deep imports** (`@lucide/svelte/icons/<name>` — the bare-barrel import is gated), sized by a recipe class (`inline-size`/`block-size` from a token), not a `size` prop. **No emojis anywhere** (gated). Icons are decorative — `aria-hidden="true"` — unless they are the only label, in which case the control needs an accessible name another way.

## Every screen's title, and the way back — one component

**Every screen states what it is through [`apps/web/src/lib/screen/screen-header.svelte`](../../apps/web/src/lib/screen/screen-header.svelte).** Not the Masthead recipe directly — that stays the design-system primitive this composes (the register, the display serif, the density step). Twenty screens assembled Masthead by hand in eight different combinations of its parts, and four more hand-rolled an `h1` over a letterspaced `p` outside the design system entirely; nothing was wrong with any one of them, but "what does a screen header look like here" had twenty-four answers and a correction had to be made twenty-four times.

The anatomy, in the order a reader meets it:

```
← ⌂ MATTERS        the way back, showing the destination in miniature — its glyph, its name
PERSON             the eyebrow: what this screen's subject IS, when that needs saying
Rosalind Chase     the title, in the display serif
she/her · …        the meta line, the citation beneath the title
```

with `actions` at the inline end of the title row, and `trailing` for a band that shares its height with something else (the matter's search over its section strip — passing it is what makes the title truncate and the band stretch, because both follow from the two-column arrangement rather than being separate decisions a caller could get inconsistently right).

**The way back is named, not drawn** (owner's direction, 2026-09-03). A screen passes a **destination id** — `back="matters"` — and the href, the user-facing label and the glyph all come from the sidebar's own registry. So a screen cannot invent a destination, cannot call it something the sidebar calls something else, and cannot go stale when a path moves; the id is a literal union, so a typo is a type error. The arrow shows the destination **in miniature**, its own sidebar mark beside its own name, because a reader should learn where the link lands rather than only that there is a way out. A screen outside the sidebar (the developer console) passes a spelled-out target from [`screen-header.ts`](../../apps/web/src/lib/screen/screen-header.ts) instead — deliberately more work to write than an id.

The way back **leads the stack** rather than sharing the eyebrow's line, so the two never compete for the same register: one names where you would go, the other names what you are looking at.

**Gated** — `pnpm run lint:back-navigation`, which answers three questions from the route tree and the registry rather than from a list:

1. every route whose nearest ancestor route renders a page of its own passes a `back` — in the page, in a layout between them, or through however many components its header is built from;
2. the destination it names resolves to that ancestor's own path (a link back to a screen the reader did not come from is worse than none);
3. nothing in the application assembles `Masthead.Root` itself, or builds its own back link out of `EyebrowLink` and an arrow icon — the second rule is what keeps the first true, because a screen with a hand-made header is free to grow its own idea of the way back, or none.

A route whose ancestors only redirect or only draw a shell is asked for nothing (`/settings/theme` is that case; its finding aid is the settings nav beside it), and a route that must decline says so in the gate's own exemption register rather than silently.

## The review rules a machine can't check

These are owner/reviewer discipline, not lint:

- **Identity lives at the edges, not in the workflow.** The visual identity (the gold accent, the Chancery character, the dark-navy chrome, the brand mark) belongs to the chrome that _frames_ the work — the app shell, navigation, page headers, empty/loading states, signature moments, primary actions. The surfaces where the user _does the work_ (tables, forms, dense data entry) stay calm: identity recedes to a light, elegant touch — a thin gold edge on a selected row, a subtle gold focus ring, a small gold check — never a gold wash across the data, never loud chrome inside the work area. The touch must feel integral, not tacked on. When adding identity to a component, ask "is this an edge (chrome) or a work surface?" and restrain accordingly. (The Fable mockups render this: dark chrome framing a light, quiet work canvas.)
- **Status colour comes in two registers; the subtle one is the default.** Each status hue ships a SOLID pair (saturated fill + light foreground — `status.<v>` / `-foreground`) and a SUBTLE trio (pale same-hue tint + deep same-hue text + a soft same-hue hairline — `status.<v>-subtle` / `-subtle-foreground` / `-subtle-border`). On a work surface, reach for the subtle trio: pills, inline callouts, alerts, and toasts read as calm, same-hue chips with a leading status glyph, not saturated blocks that fight the data (the edges rule again). Reserve the solid pair for an edge moment that must shout (a blocking banner). Both pairings are AA-gated; a status colour used as raw text on a light surface is _not_ gated — don't. See Badge, Alert, Toast.
- **Animate only compositor properties; the UI must feel fast.** Transitions and animations move `transform` and `opacity` only — never `width`/`height`/`grid-template`/`top`/`left`/`margin` or any layout property. Animating layout reflows every frame and, where one element's animated edge meets another (a collapsing rail against the work canvas), the sub-pixel seam shimmers/tears at fractional display scaling. For an unavoidable layout change (a collapse that reclaims space), make the change instant and wrap the state mutation in `runViewTransition` (`internal/view-transition.ts`) so the browser composites the before/after on the GPU — and give both sides a `view-transition-name` so each morphs instead of ghosting. Reduced-motion users get the instant change. Reach for a new animation library only when the native path (Svelte built-ins + View Transitions, the chosen 0 kB motion stack) genuinely can't deliver. (The Sidebar collapse is the worked example.)
- **No styled raw HTML outside `@magna-carta/design-system`.** App screens compose components; they do not hand-roll styled `<div>`s. (Layout utilities — flex, gap, grid — are fine; styled surfaces are not.)
- **Archetype conformance.** Every screen composes one of the five page archetypes ([`docs/specs/2026-06-12-page-archetypes.md`](../specs/2026-06-12-page-archetypes.md)) and ships its full state set (empty / loading / filtered-no-results / error / dense). Distinctiveness comes from the design language applied uniformly, never per-screen customization. The design language is [`docs/specs/2026-06-12-design-language.md`](../specs/2026-06-12-design-language.md).
- **One loading state: the component is its own skeleton** (owner ruling 2026-09-05). A region whose data has not arrived is `LoadingRegion` (`@magna-carta/design-system/loading-region`) around its real markup, with a `fixture` snippet in the same components over sample words where the markup cannot render on null data; the recipe turns the leaves into bones and keeps the furniture (frames, headings, labels, column heads). It takes `loading` and a `label` sentence in the house voice, and holds the rest of the state set itself: `failed` with a `failure` snippet (the notice with Retry, rendered first), `empty` with an `emptyState` snippet, `refreshing` for a re-read that keeps the content, and `onRetry` for the stall it states after fifteen seconds. Fixture words come from `@magna-carta/design-system/loading-fixtures`. No hand-placed `Skeleton`, no `aria-busy` written by a screen, no loading sentence, no spinner glyph — `lint:one-ui`'s `hand-placed-loading` rule fails all of them. The failure branch sits outside the region, so a failed read settles to `FailureNotice` with Retry and never leaves the shape standing. Design: [`docs/specs/2026-09-05-loading-region-design.md`](../specs/2026-09-05-loading-region-design.md); review surface: `/developer-console/loading-states`.
- **Where data will arrive, the structure that will hold it renders first, empty** (owner ruling 2026-09-14). A table renders its header row over an empty body; a definition list renders its terms with empty definitions; a rail renders its frame with one hollow marker. The words that explain the emptiness live INSIDE that structure's own empty state — `DataTable.Grid` renders "No Results" itself (it accepts no `empty` snippet — owner ruling 2026-09-14), `EventRail`'s `emptyMessage` (and its `note` for what the history does not carry yet), `DefinitionList.Empty` beneath the terms — never as a paragraph beside or beneath the structure on the canvas, and never a sentence standing where the structure would until the data is there. A fact a reader needs to read the values correctly is a row of the structure, not a caption under it. The two shapes a scan can read — a prose branch opposite a structure in one conditional, and a muted paragraph immediately after a structure — are enforced by `pnpm run lint:structured-empty` (`tooling/lint-structured-empty/`); a `LoadingRegion` whose `emptyState` snippet replaces the structure, and a component standing in for one, are the same judgment left to review.
- **Designed-but-unwired UI ships visible and marked "Soon" — never omitted, never fake-live** (owner rule, 2026-07-03). When a surface is designed ahead of its backend or machinery, render its final anatomy — including the real primary action (a submit button, a link, a toggle) — with the affordance disabled and carrying the small "Soon" Badge device, plus one honest line saying what its arrival waits on. Users see the shape of what is coming and can never mistake it for working; the design deliverable is the future UI's shape, not a placeholder. The complements: a dead link is impossible by construction (light-up registry fields like the ecosystem sites' `href: null`), and anything that LOOKS live must actually work — a firm demonstration surface whose values do not govern behavior yet carries a page-level "Preview" badge.
- **Components are shell-agnostic** (the app shell today, the client-portal shell later) — no chrome assumptions baked into a component.
- **The owner design-review gate (ADR-0053):** each tier batch is walked in the running Storybook across theme×mode and signed off (or changes filed) before the next tier starts.

## Theming at runtime

Two `<html>` attributes — `data-theme="<theme>"` + a `dark` class — applied before first paint by the inline boot script (mirrored from `internal/theme-preference.ts`). Themes are pure data; a new theme is a new resolver input. The firm theme and user mode are a **localStorage seam** today; they move to the ADR-0040 settings registry in slice 0·7b — `theme-preference.ts` is the only touch point.

**The document itself is painted once, and never by a screen.** `styles/base.css` is the only rule that touches the root: the colour scheme, the ink, and the `--mc-surface-default` background every screen sits on. A screen paints its own surfaces and nothing above them. The reason is not tidiness — every shell paints inside the Svelte tree, so an unpainted root looks correct right up until that tree stops covering the viewport (the boot of a hard load, a cross-group shell swap, an overscroll, the scrollbar gutter) and the browser's own canvas shows through. `applyThemeToDocument` additionally writes `color-scheme` as an inline style, and the boot script mirrors that line: the stylesheet is a separate request, and with `ssr = false` behind an `index.html` fallback the window before it arrives is the whole boot against an empty body.

## Browser verification — the loop that gives review eyes

Every other gate here reads source text. None of them looks at a rendered pixel, so "the classes are
right" and "the screen is right" are different claims and only the first one is machine-checked. The
browser closes that gap.

**The tool** is the Chrome DevTools MCP server, declared in the repo's [`.mcp.json`](../../.mcp.json)
and approved per machine on first use. It supplies exactly what the working model above asks a
coordinator for: screenshots, computed styles, the console, network, and interaction round-trips
against the running app.

- **Point it at something real.** `vp run worker-dev` for a full app screen (the SPA alone cannot
  answer an API question); `pnpm --filter @magna-carta/design-system run storybook` for a component
  in isolation across theme x mode.
- **A screenshot is evidence; a claim is not.** An agent reporting "the spacing is correct" without
  a rendered view is reporting an intention. Verify before the commit, not after the review.
- **Check both modes and at least two themes.** Most contrast and identity-placement defects only
  exist in one of them.
- **This does not replace visual regression.** The browser answers "is this right"; the baselines
  answer "did this change". See _Visual regression_ below for why the second one is still dark.

## Definition of done (appearance _and_ behaviour)

A component is not done until it has all of:

- a **catalog entry** — the Docs page is the single review surface (description → controllable Primary + Controls → the "Properties" table → every instance as its own block);
- **behaviour tests** — the story `play` functions run in the Storybook Vitest browser project (`vp test`);
- **accessibility** — per-story axe (enforced as failures) _and_ the batch **NVDA screen-reader pass**;
- **visual regression** — Playwright screenshots across every theme×mode;
- **docs current** — this file / the area `CLAUDE.md` / ROADMAP / CHANGELOG updated in the same commit (golden rule 5).

See [`testing.md`](testing.md) for the test-layer detail.

## Visual regression

Screenshots of every story×theme×mode over the static catalog, compared against committed baselines (`packages/design-system/visual-regression/`). **Baselines are authoritative only from the pinned Playwright container** (`mcr.microsoft.com/playwright:v<version>-noble`) — OS font rendering differs, so a Windows/macOS baseline poisons the suite. Regenerate via `update-baselines.cmd`/`.sh` (Docker) or the CI container job; the harness skips explicitly until baselines exist. Never commit a non-container baseline.

**Current reality: there are no baselines and no job that makes them.** There is no `visual-regression/baselines/` directory, no committed image, and no workflow that runs the suite; the harness README points at a CI container job that was never written. The suite therefore announces its named skip on every run. Until a baseline set is generated from the pinned container and committed, treat this gate as absent rather than as passing — the browser loop above is what covers UI review in the meantime, and it answers a different question.

> The "tokens + components only" and "Lucide only / no emojis" invariants are summarized in the root [`CLAUDE.md`](../../CLAUDE.md) (golden rule 2).
