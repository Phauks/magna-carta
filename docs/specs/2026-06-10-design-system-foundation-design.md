# Design-system foundation — design (slice 0·7a)

**Status:** Approved design, pre-implementation. **Decides:** ADR-0076 (supersedes ADR-0028). **Builds on:** white paper _Design system, UI consistency & design quality_ (ADR-0053 — design quality & the design process), _Architectural integrity & coherence_ (ADR-0051 — registry-first, fitness functions), ADR-0040 (settings registry — where the firm theme choice and user mode preference live), ADR-0055 (time model — `@internationalized/date` interop), ADR-0070/0071 (package boundaries). **Prepares for:** slice 0·7b (auth UI + client-reporter surfaces — the first consumer), every UI slice thereafter.

The token pipeline, theming model, and component layer that make golden rule 2 ("all UI through the design system") enforceable — homogenization as a property the system has, not work anyone does. Design decisions exist in exactly one place; screens are structurally unable to state their own.

This slice splits the roadmap's slice 0·7 in two: **0·7a (this spec)** is the design-system foundation; **0·7b** is the auth UI, passkeys, and the client-reporter/diagnostics surfaces deferred from slices 0·4/0·6, designed separately as the foundation's first consumer.

## 0. Research basis — the stress test

Every load-bearing tooling choice below was adversarially re-verified against primary sources (npm registry, GitHub APIs, issue trackers, vendor docs) on 2026-06-09/10, with the explicit goal of killing the incumbent choices. Two survived with conditions, one was replaced, one resolved by ecosystem death:

- **DTCG 2025.10** (first stable token spec, October 2025) — its **Resolver module** makes multi-theming in-spec: contexts with fallback chains, no value duplication, no vendor extensions. The legacy `$extensions.mode` pattern is dead.
- **Terrazzo 2.x survives** — sole shipped implementation of DTCG 2025.10 resolvers plus a purpose-built Tailwind v4 `@theme` plugin; releasing actively; used by two government design systems (New York State, Swedish Migration Agency). Its real weakness — bus factor 1, ~31k weekly downloads vs Style Dictionary's 1.84M — is mitigated structurally (§2.5): abandonment costs days, not a rewrite. Style Dictionary v5 cannot replace it today: its resolver support is an open issue with no timeline, and its interim multi-theme story is the proprietary Tokens Studio `$themes.json` — more lock-in, not less.
- **shadcn-svelte is replaced** (the ADR-0028 amendment): the shadcn look lives in the copied Tailwind class strings (radii, spacing, shadows, focus rings), not the CSS variables — escaping it means rewriting ~46 vendored files, converging on the cost of building from headless while adding permanent fork maintenance; and its fixed `--primary`/`--primary-foreground` vocabulary competes with the richer token taxonomy this platform needs. The styled layer is built in-house **directly on Bits UI v2** — the same headless engine shadcn-svelte sits on (~705k weekly downloads, the most field-tested behavior layer in Svelte; actively maintained; one epochal API break already behind it). shadcn-svelte's source remains a **reference corpus** — read for composition patterns, never installed.
- **Storybook 10 resolves ADR-0028's "Storybook/Histoire"** — Histoire's last release was April 2024 and it never supported Svelte 5; Storybook 10 + `@storybook/addon-svelte-csf` v5 is the only living Svelte 5 workshop, and its Vitest addon + a11y addon turn every story into a behavior test and an axe check.

## 1. Packages

Two new packages, extending the ADR-0071 layout on the same seam logic (structure vs consumption):

| package                      | owns                                                                                          | depends on                                           |
| ---------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `@magna-carta/design-tokens` | the DTCG token source, theme resolver contexts, the Terrazzo build, palette generation, gates | (dev: Terrazzo, Culori)                              |
| `@magna-carta/design-system` | the styled component layer, variants, the catalog (Storybook), component tests                | `design-tokens`, `bits-ui` (pinned), satellites (§4) |

`apps/web` consumes both; no app code imports `bits-ui` directly (fitness function, §6). The Storybook catalog lives inside `@magna-carta/design-system` as its dev harness, not a separate app.

## 2. Token architecture — `@magna-carta/design-tokens`

### 2.1 Source format

Tokens are authored as **spec-pure DTCG 2025.10 JSON** — no `$extensions`, no Terrazzo `tzMode`, no vendor anything (the documented "stranded tokens" footgun and the portability guarantee both bind here). Multi-theming uses **standard resolver documents** only. Spec purity is itself a fitness function (§2.5): it is what keeps Style Dictionary a drop-in escape hatch.

### 2.2 Two token tiers

1. **Primitives** — the raw scales, theme-independent in name, theme-supplied in value: OKLCH palette ramps (`color.neutral.0–1000`, `color.brand.*`, accent ramps), the spacing scale, the type scale (family/size/weight/line-height/tracking), radii, shadows/elevation, z-index layers, motion durations/easings, breakpoints.
2. **Semantic aliases** — the only names the component layer may consume: `surface.*` (default/raised/sunken/overlay), `text.*` (default/muted/subtle/inverse/link), `action.*` (primary/secondary/destructive + hover/active/disabled states), `border.*`, `focus.*`, `status.*` (info/success/warning/danger — plus the legal-domain statuses later slices register: trust, hold, conflict), `density.*` (the spacing/control-height aliases that make a future density axis a token edit, not a retrofit), and `motion.reduced-scalar` — a duration multiplier every animation consumes that drops to ~0 under `prefers-reduced-motion`, making reduced-motion compliance structural rather than per-component (added 2026-06-10 from the motion research).

Component-level tokens (a third tier) are deliberately deferred until a real second consumer (Tauri theming, white-label) demands them — YAGNI; the semantic tier is the contract.

### 2.3 Theming model

- **Axes:** `theme` (the curated gallery) × `mode` (`light`/`dark`), expressed as DTCG resolver contexts. A `contrast` axis (high-contrast variants) is reserved in the resolver document structure but unpopulated.
- **Launch gallery (owner-decided):** one flagship default theme plus **two to three showcase themes**, every theme shipping both modes. Themes are pure data — adding one is a new resolver input, zero component changes.
- **Selection:** the **firm** picks the theme (a firm setting in the ADR-0040 settings registry, firm-admin gated); each **user** picks mode (`light`/`dark`/`system` — a user setting). Runtime application is two attributes on `<html>`: `data-theme="<theme>"` + the mode class; CSS custom-property cascade does the rest. No theme-conditional code anywhere; no rebuild; no FOUC (the boot inline script reads the persisted preference before first paint — same pattern as every mode switcher, written once).
- **Density:** a single density at launch, tuned during the design-language pass (§5) — deliberately not the airy consumer default, but decided by judgment, not assumption. The `density.*` semantic aliases keep a future comfortable/compact axis additive.
- **Arbitrary per-firm brand palettes** (firm picks any hue, we generate an accessible theme with Culori) are **designed-for but out of scope**: the generation script (§2.4) is built for authoring the gallery, so the future upgrade is exposing it, not building it.

### 2.4 Build pipeline

- **Terrazzo 2.x, pinned exact** (its 2.3.0 release shipped a breaking change in a minor — pins are not optional), via `@terrazzo/cli` + `@terrazzo/plugin-css` + `@terrazzo/plugin-tailwind`.
- Outputs (generated, never hand-edited, committed — the CI drift gate regenerates and diffs): the CSS custom-property files per theme×mode context (`[data-theme="…"]`, `[data-theme="…"].dark` blocks) and the Tailwind v4 `@theme` file (`@tz` pulling resolved tokens). Tailwind utilities are thereby defined **only** from tokens — the app has no vocabulary for off-scale values.
- **Palette authoring is programmatic:** a Culori-based script (OKLCH color math — the library Tailwind v4 itself uses) generates each theme's ramps from a small set of authored anchor decisions, so gallery themes are derived consistently rather than hand-picked swatch by swatch.

### 2.5 Gates (the package's tests)

1. **Golden-file snapshots** of every generated CSS artifact — any future generator swap (or Terrazzo upgrade) is verified byte-consciously against known-good output; this is the escape-hatch insurance made mechanical.
2. **WCAG 2.2 contrast gate:** every semantic foreground/background pairing the design language declares is computed for every theme×mode and must clear AA; APCA is computed as advisory signal, never the gate (it left the WCAG 3 draft; 2.2 ratios remain the compliance floor).
3. **Completeness check:** every theme×mode context resolves every semantic token — the class of silent half-themed bugs the no-DTCG alternative would have invited, eliminated structurally.
4. **Spec-purity check:** token files parse as standard DTCG with no vendor extensions.

## 3. Component layer — `@magna-carta/design-system`

### 3.1 Foundation

**Bits UI v2, pinned, upgraded deliberately** (pin `bits-ui` and `svelte` together). Bits supplies behavior and accessibility (Floating UI positioning, focus management, keyboard interaction, the strongest date components in the Svelte ecosystem); this package supplies every styled pixel. A recurring **GitHub sponsorship of the maintainer** is part of the decision — cheap insurance on a load-bearing dependency whose funding goal is half-met.

### 3.2 Structure

The proven registry shape (shadcn-svelte's, which is the community-converged way to wrap Bits): one directory per component, one small file per part, an `index.ts` barrel exporting parts + namespace:

```
src/lib/components/<name>/<name>-<part>.svelte
src/lib/components/<name>/index.ts
src/lib/internal/        — floating/presence wrapper, variants, mergeClasses, type helpers
```

Packaged with `@sveltejs/package` (`svelte` export condition, subpath export per component, `typesVersions` for subpath types). The consuming app adds one `@source` directive for the package `dist` so Tailwind scans wrapper class usage — and `node_modules` otherwise stays out of `@source` scope (the known tailwind-merge × Tailwind v4 scan-bloat interaction).

### 3.3 Styling discipline — what makes "no off-token values" checkable

- **Semantic component classes in a CSS layer** (the direction shadcn-svelte itself converged on in 2026): each component's visual recipe is a class (`mc-button`, `mc-button-primary`, `mc-select-content`) defined in CSS fed **exclusively by token custom properties**. Wrapper `.svelte` files carry structural utilities and `data-[state=…]` styling only. Off-token values therefore have no place to hide in component markup, and the lint surface (§6) is small and mechanical.
- **Variants are plain typed functions** returning class compositions — no variant DSL dependency (tailwind-variants shipped three breaking majors in nine months of 2025; class-variance-authority is frozen at 0.x with a multi-year beta). If slots/compound variants ever earn a DSL, it gets adopted pinned and wrapped behind `src/lib/internal/variants.ts` so churn is a one-file migration.
- **`mergeClasses()`** (clsx + tailwind-merge) is the single class-merge utility, with tailwind-merge **extended to register every non-color token namespace** (spacing, radius, shadow, z, typography) — unregistered custom namespaces silently fail to merge, a documented footgun closed at setup.
- **One internal floating/presence wrapper** encapsulates the Bits v2 transition pattern (`forceMount` + `child` snippet + `{#if}`) and the two-level floating rule (outer `wrapperProps` element stays unstyled — it carries Floating UI positioning; styling goes on the inner element). Built once, reviewed once, used by every floating part.
- **Z-index is a token scale** (`z.dropdown`, `z.modal`, `z.toast`, …) — Bits portals impose no z-index of their own, which is an asset: raw `z-*` numerals are banned (lint) and layering is owned by tokens.
- **Type helpers:** the four `WithElementRef`/`Without*` prop-type utilities (the settled Svelte 5 wrapper idiom — rename `class` in the destructure, `$bindable` ref, rest-spread; `Omit` the `child` snippet from public props where the wrapper consumes it internally).

### 3.4 Inventory — ~28 components in four build tiers

Build order is by tier; the token plumbing is proven on cheap components before the expensive ones spend it.

- **Tier 1 — pure HTML, no Bits** (~0.5 day each): Button, Input, Textarea, Label, Badge, Card, Separator, Skeleton, Alert, Kbd.
- **Tier 2 — single primitive** (~0.5–1 day each): Checkbox, Switch, RadioGroup, Tabs, Accordion, Tooltip, Avatar, Progress.
- **Tier 3 — floating/portal** (~1–2 days each): Dialog, AlertDialog, Sheet, Popover, DropdownMenu, Toast (svelte-sonner, §4).
- **Tier 4 — composition-heavy** (~2–4 days each, dedicated timeboxes): Select, Command (palette), Combobox (with the virtualization wrapper, §4), Calendar + DatePicker/DateRangePicker, Form field family (§4), DataTable (§4).
- **App shell** (hand-built on primitives, archetype-driven): the sidebar/navigation pattern (Collapsible + Tooltip composition; shadcn-svelte's sidebar block is the reference), resizable panes via paneforge.

First-pass estimate, calibrated against shadcn-svelte's actual registry sizes: **150–250 files, ~8–12k lines, roughly 7–11 engineer-weeks** — with the honest caveat that the four Tier 4 composites carry most of the risk.

## 4. Satellite dependencies (all verified June 2026)

| concern             | choice                                                                                                                                                                | rationale / condition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Toast               | **svelte-sonner** (pinned)                                                                                                                                            | Bits has no toast (request closed); 376k weekly, Svelte 5 native                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| List virtualization | **virtua**                                                                                                                                                            | TanStack Virtual's Svelte adapter is effectively abandoned (Svelte 5 issue open since 2024); virtua is Svelte 5 first-class. One in-house wrapper composes it with Combobox/Select for 10k-item pickers (matters, contacts)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Data table          | **`@tanstack/table-core`** + a thin in-house Svelte 5 adapter                                                                                                         | The headless core is the stable bet; swap to the official `@tanstack/svelte-table` v9 adapter when it leaves beta (beta.1 shipped 2026-06-05). AG Grid Enterprise ($999/dev/yr, no official Svelte) reserved for a future spreadsheet-class screen                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Resizable panes     | **paneforge** (pinned)                                                                                                                                                | Stable-but-dormant (10 months); small, shadcn-svelte's own Resizable base; assume we patch if Svelte async-SSR breaks it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Dates               | **`@internationalized/date`** (Bits peer dependency)                                                                                                                  | `CalendarDate` is exactly the ADR-0055 civil-date semantics; 10.6M weekly, Adobe-maintained, Temporal-convergent; feed `CalendarDate` (never `ZonedDateTime`) to calendar components — sidesteps the open zone-shift bug                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Icons               | **`@lucide/svelte`**, deep imports only (`@lucide/svelte/icons/…`)                                                                                                    | Per-icon tree-shaking; root barrel imports banned (lint)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Forms               | **sveltekit-superforms + formsnap**, contracts on **Standard Schema**                                                                                                 | formsnap is quiet (stable-done); the Standard Schema boundary keeps SvelteKit's native remote-function `form` a drop-in transport replacement without touching field components                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Motion              | **Svelte 5 built-ins + View Transitions API** in the core (0 kB); **GSAP + DrawSVG + SplitText lazy-loaded** for signature moments only (wordmark writing, hero text) | Decided 2026-06-10 from [`docs/research/motion-animation-stack.md`](../research/motion-animation-stack.md): built-ins + the now-Baseline View Transitions API cover all functional motion token-parameterized; GSAP (free since the Webflow acquisition, including all plugins — proprietary no-charge license, recorded) is the only tool covering both signature text effects, kept out of the core bundle; Lottie/Rive runtimes rejected for the wordmark (a self-drawing SVG costs nothing); typewriter hand-rolled (~40 lines, every npm option stale). A JS-side `prefersReducedMotion` gate is mandatory — CSS media queries do not stop JS engines, and Playwright's `animations: 'disabled'` does not freeze requestAnimationFrame |

## 5. Design language & page archetypes — the human-judgment artifacts

Per the white paper (_Design quality & the design process_, ADR-0053), the foundation that components are styled **to** is authored before any Tier 1 styling, deliberately, owner-deciding with agent assistance (the visual companion):

1. **Design language:** the type system and scale, the flagship palette and the showcase themes' anchor decisions (fed to the §2.4 generation script), spacing and the single launch density, elevation/border philosophy, functional motion, and one or two signature elements — anchored to explicit best-in-class references.
2. **Page archetypes:** List/Index, Record Detail, Editor, Form/Wizard, Dashboard — each fixing layout grammar, information hierarchy, and the full state set (empty/loading/error/dense). Screens compose archetypes; distinctiveness comes from the foundation applied uniformly, never per-screen customization.

Both land as documents in this slice (the design-language artifact + archetype templates in `docs/specs/`, summarized for practitioners in `docs/conventions/ui-design.md`, which this slice promotes from stub to standard).

## 6. Catalog, testing & enforcement

Every component, no exceptions (the definition of done for a design-system component):

1. **Storybook 10** + `@storybook/addon-svelte-csf`: stories covering every variant × state — the single place components are defined and reviewed.
2. **Behavior tests:** the Storybook **Vitest addon** runs the stories as browser-mode component tests (real browser via Playwright).
3. **Accessibility:** `addon-a11y` runs axe per story in CI; a **manual screen-reader pass per component batch** (NVDA at minimum) — no candidate library has a third-party audit, so the audit is ours; keyboard-first ergonomics is a review item, not a hope.
4. **Visual regression:** Playwright `toHaveScreenshot` over the catalog **across every theme × mode**, baselines generated inside the pinned Playwright Docker image in CI (the deterministic-rendering discipline: fonts waited, animations disabled, dynamic regions masked). **Argos CI** (open-source, self-hostable) is the named upgrade when git-committed baselines outgrow review needs; Chromatic the runner-up; Lost Pixel dead (archived April 2026); Percy outclassed.
5. **Lint/fitness functions** (Oxlint + dependency-cruiser tiers per ADR-0051): no Tailwind arbitrary values (`p-[13px]`), no raw color literals, no raw `z-` numerals, no styled raw HTML elements outside `@magna-carta/design-system`, no `bits-ui` import outside the package, Lucide deep imports only, no emojis.
6. **CI token gates:** generated-output drift check (regenerate and diff), the §2.5 contrast/completeness/purity/golden gates.

## 7. Risk register (eyes open, priced)

| risk                                                                                 | mitigation                                                                                                                                                                              |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Terrazzo bus factor 1; slow triage on non-core bugs; breaking minors                 | Pin exact; spec-pure tokens + standard resolver docs; golden files; Style Dictionary v5 as the named escape hatch (re-evaluate when its resolver module ships) — abandonment costs days |
| Bits UI single-maintainer funding (sponsorship goal ~half met)                       | Recurring sponsorship; pinned versions, deliberate paired svelte/bits upgrades; the styled layer is ours either way                                                                     |
| **Bits scroll-lock sets inline styles → breaks strict CSP `style-src` (open #1995)** | **Week-1 spike:** Dialog under the platform's intended CSP before Tier 3; outcomes: upstream fix/PR, scoped patch, or a documented CSP allowance — recorded when known                  |
| Component-layer bundle floor (~100–150 KB gzip with dependencies)                    | Accepted — amortized across 25+ components; no per-component export paths shipped upstream yet (tracked)                                                                                |
| Variant-DSL ecosystem churn                                                          | Plain typed functions; any DSL pinned behind one internal module                                                                                                                        |
| Virtualization is ours to own                                                        | One standard wrapper (virtua) for all long-list composition; built and tested once                                                                                                      |
| LayerChart (the chart layer) still pre-release after 18 months                       | Charts deferred entirely — no chart dependency in this slice                                                                                                                            |
| formsnap dormancy                                                                    | Standard Schema contract keeps the field layer transport-agnostic; superforms healthy                                                                                                   |

## 8. Out of scope (deliberate, with named seams)

- **Auth UI, passkeys, client-reporter surfaces, breadcrumb library, screenshot capture, diagnostics settings UI** — slice 0·7b, the foundation's first consumer.
- **Charts** — wait out LayerChart v2 pre-release; revisit at the Reports slice.
- **Density toggle** — the `density.*` aliases are the seam.
- **Arbitrary per-firm brand colors** — the Culori generation script is the seam; productizing it (firm admin picks a hue, gets a validated theme) is a future slice.
- **High-contrast variants** — the reserved `contrast` resolver axis.
- **Design-tool round-trip** (Penpot is DTCG-native on disk and the natural pair if a visual design surface is ever wanted) — watch-listed, nothing built.
- **Tauri/native token export** — DTCG keeps it open; the desktop shell is a webview, so CSS remains the only consumption format actually needed.

## 9. Rejected alternatives (recorded so they are not relitigated)

- **shadcn-svelte as the component foundation** — rejected for this platform's requirements (distinctive design language, strict token taxonomy): the look survives variable re-theming (it lives in vendored class strings), restyling converges on headless-build cost while adding permanent fork maintenance, and its CSS-variable vocabulary conflicts with the richer semantic tier. Retained as an uninstalled reference corpus.
- **Ark UI Svelte** — credible architecture (Zag statecharts; Skeleton v3 proves Zag in production Svelte), but one year old, ~3k weekly downloads, and missing Command palette, Menubar, and TimeField — three center-of-product widgets. Revisit in 12–18 months; à-la-carte adoption (tree view, file upload) stays open.
- **Style Dictionary v5 today** — resolver support unshipped; the interim `$themes.json` path is proprietary lock-in. It is the escape hatch, not the choice.
- **Hand-rolled token generator** — 2–4k lines of color-serialization and resolver-permutation correctness owned forever, rebuilding what Terrazzo ships; survives only as the documented contingency shape (a thin emitter over a spec-compliant parser).
- **No-DTCG (hand-authored Tailwind `@theme` CSS per theme)** — zero toolchain risk, but the theme gallery × mode matrix becomes unvalidated hand-written CSS; the completeness gate is the point.
- **Skeleton v4** — genuinely token-native but imposes its own design language and token taxonomy; **Flowbite Svelte** — class-override theming and a weak accessibility record; **Carbon Components Svelte** — wrong stack (Carbon SCSS tokens vs Tailwind, not runes-native); **daisyUI** — CSS-only skin with no behavior layer; **Melt UI next-gen** — pre-1.0 and stalled.
- **Histoire** — dead (no release since April 2024, never Svelte 5). **Chromatic-first / Lost Pixel / Percy / vitest-axe** — managed-cost, archived, outclassed, and stale respectively.
- **Per-user theme choice** — rejected: the theme is firm identity (the firm admin picks); the user keeps the mode choice.
- **Density toggle at launch / broad firm customization / theme editing UI** — rejected as the homogenization-pain generators this slice exists to prevent; each has a named seam above.
