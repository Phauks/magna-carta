# Slice 0·7a — Design-System Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@magna-carta/design-tokens` (spec-pure DTCG 2025.10 tokens, resolver-based theme gallery × light/dark, Terrazzo build, contrast/completeness/purity/golden gates) and `@magna-carta/design-system` (the in-house styled component layer directly on Bits UI v2, Storybook catalog, visual-regression harness, fitness functions) per the approved spec [`2026-06-10-design-system-foundation-design.md`](2026-06-10-design-system-foundation-design.md) (ADR-0076).

**Architecture:** Tokens are the single editable source; Terrazzo generates committed CSS custom properties per theme×mode plus the Tailwind v4 `@theme`; the component package styles headless Bits UI primitives through semantic component classes fed only by token variables; Storybook stories triple as behavior tests (Vitest addon) and axe checks (a11y addon); Playwright screenshots the catalog across every theme×mode. Theming at runtime is `data-theme` + a mode class on `<html>` — pure data.

**Tech Stack:** TypeScript, Svelte 5 (runes), Tailwind v4 (`@tailwindcss/vite`), Terrazzo 2.x, Culori, Bits UI v2, Storybook 10 (`addon-svelte-csf`, `addon-vitest`, `addon-a11y`), Playwright, clsx + tailwind-merge, svelte-sonner, virtua, `@tanstack/table-core`, paneforge, `@internationalized/date`, `@lucide/svelte`, sveltekit-superforms + formsnap. Vitest via `vp`; pnpm catalog pins.

---

## Decided up front (read before coding)

1. **Build timing & version re-verification.** The build runs **now, as Phase 0's parallel UI-foundation lane** (owner-decided 2026-06-10), on branch `slice-0.7a-design-system` in a worktree outside the main checkout — the backend lane (0·4 → 0·5 → 0·6) proceeds independently; the only shared file expected to conflict is `ci.yml` (mergeable) and `pnpm-workspace.yaml` (append-only catalog additions). **Task 0 re-verifies every pinned version and every external API shape against current documentation before anything else** (golden rule 11). Versions named in this plan are the June-2026 verified baselines; bump-and-re-verify, never trust silently.
2. **Source-direct package exports, no dist build.** Every package in this repo exports TypeScript source directly (`"./x": "./src/x.ts"`) and nothing has a build step — Vite/`vp` compiles workspace sources, including `.svelte` files via `vite-plugin-svelte`. `@magna-carta/design-system` follows suit: subpath exports point at `src/`, **no `@sveltejs/package` dist step** (the spec's packaging note is realized this way for the internal monorepo; revisit only if the package ever publishes externally). Tailwind's `@source` directive points at the workspace package's `src/`.
3. **Provisional theme before the design language.** The pipeline is built and gated against a provisional flagship theme (`slate`, light + dark, generated neutral ramps). The Phase B design-language workshop (owner-deciding) replaces values and adds the showcase themes; the gates and golden files then re-pin. This keeps engineering unblocked and makes the workshop a data change, proving the whole premise.
4. **Token CSS variable prefix is `--mc-`** (e.g. `--mc-surface-default`, `--mc-space-4`, `--mc-z-modal`). Tailwind utilities map onto them via the generated `@theme`. Semantic names follow the spec §2.2 taxonomy.
5. **Generated outputs are committed** under `packages/design-tokens/generated/`; CI regenerates and diffs (drift gate). Never hand-edit generated files.
6. **Gates run on generated CSS, not on Terrazzo internals** — purity parses the source JSON; completeness/contrast/golden parse the emitted CSS. This keeps every gate valid across a future generator swap (the Style Dictionary escape hatch).
7. **"Lint" enforcement lands as fitness-function tests** (house pattern, ADR-0051 tier 2/3): Vitest tests that scan source files for arbitrary-value utilities, raw color literals, raw `z-` numerals, `bits-ui` imports outside the design-system package, and `@lucide/svelte` root-barrel imports. Oxlint JS-plugin rules can supersede them later; the tests are the contract. ("No styled raw HTML outside the package" is a review rule + archetype discipline — not deterministically lintable; documented in `ui-design.md`.)
8. **Theme/mode persistence is a localStorage seam in this slice.** The firm theme setting and user mode setting move to the ADR-0040 settings registry in slice 0·7b (when auth UI + settings surfaces exist). The boot script and switcher utility are written against a tiny `themePreference` module so the storage swap is one file.
9. **Storybook runs its own Vite.** The repo overrides `vite` to `@voidzero-dev/vite-plus-core` — Task 12 verifies Storybook tolerates the override (it is API-compatible Vite); if not, scope a `vite` dev-dependency resolution for the design-system package only and record it.
10. **Bits UI doc verification is per-component.** Every component task's first step is reading the current Bits UI docs page for that component (parts, `data-*` attributes, CSS variables, snippet props). The exemplar tasks (Button, Tabs, Dialog, Select) show the full normative pattern; sibling components repeat it against their own doc page — never copy an exemplar's attribute names blind.
11. **Floating components follow the two-level rule** — outer `wrapperProps` element unstyled (Floating UI positioning), inner element styled. Encapsulated once in `src/lib/internal/floating.ts` helpers + reviewed there only.
12. **Dates:** calendar components are typed to `CalendarDate` (never `ZonedDateTime`) per ADR-0055 and the known weekday-shift bug.
13. **Commits** per task, conventional style (`feat(design-tokens): …`, `feat(design-system): …`, `docs: …`), trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
14. **Run tests per package:** `pnpm --filter @magna-carta/design-tokens test` / `--filter @magna-carta/design-system test`. Full gate at the end of each phase: `pnpm check` from the repo root.
15. **Sponsorship:** the Bits UI recurring sponsorship (spec §3.1) is an owner action item, raised at Phase C start — not a code task.

## File structure

```
pnpm-workspace.yaml                              MODIFY  + catalog pins (Task 0)
packages/design-tokens/
  package.json / tsconfig.json                   CREATE
  tokens/primitives/{color,dimension,typography,shadow,z-index,motion}.json   CREATE
  tokens/semantic.json                           CREATE
  tokens/themes/{slate-light,slate-dark}.json    CREATE  (provisional; workshop replaces/extends)
  resolver.json                                  CREATE  DTCG 2025.10 resolver document
  terrazzo.config.mjs                            CREATE
  scripts/generate-theme.ts                      CREATE  Culori OKLCH ramp generation
  src/contrast-pairs.ts                          CREATE  declared fg/bg pairings (the contrast gate's input)
  src/parse-generated-css.ts                     CREATE  shared test helper (parse vars per context)
  generated/{tokens.css,tailwind-theme.css}      GENERATED (committed)
  test/{purity,completeness,contrast,golden,generate-theme}.test.ts  CREATE
  CLAUDE.md                                      CREATE
packages/design-system/
  package.json / tsconfig.json / components.json-free  CREATE (no shadcn tooling)
  src/lib/styles/components.css                  CREATE  semantic component classes (token-fed)
  src/lib/internal/{merge-classes,types,variants,floating}.ts  CREATE
  src/lib/internal/theme-preference.ts           CREATE  localStorage seam (slice 0·7b swaps storage)
  src/lib/components/<name>/…                    CREATE  ~28 components, tiered
  .storybook/{main,preview}.ts                   CREATE
  src/stories/**.stories.svelte                  CREATE  per component
  test/fitness/*.test.ts                         CREATE  the §6 lint-equivalent scans
  visual-regression/{playwright.config.ts,catalog.spec.ts}  CREATE
  CLAUDE.md                                      CREATE
apps/web/src/app.css                             CREATE  tailwind + token imports
apps/web/src/app.html                            MODIFY  theme boot inline script
apps/web/vite.config.ts (or svelte config)       MODIFY  @tailwindcss/vite
docs/specs/2026-06-XX-design-language.md         CREATE  (Phase B output, owner-approved)
docs/specs/2026-06-XX-page-archetypes.md         CREATE  (Phase B output)
docs/conventions/ui-design.md                    MODIFY  stub → standard (Phase E)
.github/workflows/ci.yml                         MODIFY  storybook build + VRT job
ROADMAP.md / CHANGELOG.md                        MODIFY  same-commit docs
```

---

## Phase A — `@magna-carta/design-tokens`

### Task 0: Version re-verification + catalog pins

**Files:** Modify: `pnpm-workspace.yaml`

- [ ] **Step 1: Re-verify current stable versions** (web search / npm) for every package below; update the numbers if moved, and **check each tool's changelog for breaking changes against the spec's assumptions** (Terrazzo resolver + Tailwind plugin behavior; Storybook svelte-csf API; Bits UI v2 API):
      baselines (June 2026): `@terrazzo/cli` 2.3.0, `@terrazzo/plugin-css` 2.3.0, `@terrazzo/plugin-tailwind` 2.3.0, `culori` (latest), `tailwindcss` 4.x + `@tailwindcss/vite` (latest 4.x), `bits-ui` 2.18.1, `storybook` 10.4.x, `@storybook/addon-svelte-csf` 5.0.9, `@storybook/sveltekit` 10.4.x, `@storybook/addon-a11y` + `@storybook/addon-vitest` 10.4.x, `@playwright/test` (latest), `clsx` (latest), `tailwind-merge` 3.6.0, `svelte-sonner` 1.1.1, `virtua` 0.49.1, `@tanstack/table-core` 8.x latest, `paneforge` 1.0.2, `@internationalized/date` 3.12.2, `@lucide/svelte` 1.17.0, `sveltekit-superforms` 2.30.1, `formsnap` 2.0.1, `apca-w3` (advisory only).
- [ ] **Step 2: Add exact pins to the catalog** in `pnpm-workspace.yaml` under new comment groups `# Design tokens (packages/design-tokens)` and `# Design system (packages/design-system)`, matching the existing exact-pin style.
- [ ] **Step 3: Commit** — `chore(design-tokens,design-system): catalog pins for the slice 0·7a toolchain`.

### Task 1: Scaffold `@magna-carta/design-tokens` + provisional token source + Terrazzo build

**Files:** Create: `packages/design-tokens/{package.json,tsconfig.json,terrazzo.config.mjs}`, `tokens/**`, `resolver.json`

- [ ] **Step 1: Read the current Terrazzo docs** for resolvers and the Tailwind plugin (`terrazzo.app/docs/guides/resolvers`, `…/integrations/tailwind`, `…/integrations/css`) and the DTCG resolver module (`designtokens.org/tr/2025.10/resolver`). The resolver document shape below must be corrected to whatever the spec + Terrazzo actually accept — this is the one externally-owned schema in the package.
- [ ] **Step 2: `package.json`** (house style — scripts only, source exports):

```json
{
  "name": "@magna-carta/design-tokens",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "sideEffects": false,
  "exports": {
    "./tokens.css": "./generated/tokens.css",
    "./tailwind-theme.css": "./generated/tailwind-theme.css",
    "./contrast-pairs": "./src/contrast-pairs.ts"
  },
  "scripts": {
    "build": "tz build",
    "generate-theme": "vp run-script scripts/generate-theme.ts",
    "test": "vp test run"
  },
  "devDependencies": {
    "@magna-carta/tsconfig": "workspace:*",
    "@terrazzo/cli": "catalog:",
    "@terrazzo/plugin-css": "catalog:",
    "@terrazzo/plugin-tailwind": "catalog:",
    "@types/node": "catalog:",
    "culori": "catalog:",
    "vitest": "catalog:"
  }
}
```

(`vp run-script` — verify the actual `vp` script-running invocation; fall back to `node --experimental-strip-types` per repo norms if `vp` has none.)

- [ ] **Step 3: Author the provisional token source.** Primitives — `tokens/primitives/color.json` (an 11-step `neutral` ramp `0–1000` and a `brand` ramp, OKLCH, generated by hand-running the Task 5 script once it exists; initial hand values acceptable), `dimension.json` (spacing scale `space.0–space.24` on a 4px grid; radii `radius.{none,sm,md,lg,full}`; control heights `control.{sm,md,lg}`), `typography.json` (font families `font.{sans,mono}`, sizes `text.{xs,sm,md,lg,xl,2xl}` with line heights, weights `weight.{regular,medium,semibold}`, tracking), `shadow.json` (`elevation.{0,1,2,3}` composite shadows), `z-index.json` (`z.{base,dropdown,sticky,overlay,modal,toast}` = 0/1000/1100/1200/1300/1400), `motion.json` (`duration.{instant,fast,normal,slow}` = 0/100/200/300ms, `easing.{standard,decelerate,accelerate}`). All entries DTCG: `{"$type":…,"$value":…}` groups, nothing else.
- [ ] **Step 4: Author `tokens/semantic.json`** — aliases only (`"$value": "{color.neutral.50}"` references), covering exactly the spec §2.2 names: `surface.{default,raised,sunken,overlay}`, `text.{default,muted,subtle,inverse,link}`, `action.{primary,primary-hover,primary-active,primary-foreground,secondary,…,destructive,…,disabled,disabled-foreground}`, `border.{default,strong,focus}`, `focus.ring`, `status.{info,success,warning,danger}` (each with a `-foreground` pair), `density.{gutter,stack,control-height}` (aliasing dimension primitives).
- [ ] **Step 5: Author the provisional theme files + resolver.** `tokens/themes/slate-light.json` and `slate-dark.json` override the color-bearing semantic aliases per mode (dark inverts the neutral ramp mapping). `resolver.json` (correct to the verified schema):

```json
{
  "name": "magna-carta",
  "description": "Theme gallery x mode resolver — every context must resolve every semantic token (gated).",
  "sets": [
    {
      "values": [
        "tokens/primitives/color.json",
        "tokens/primitives/dimension.json",
        "tokens/primitives/typography.json",
        "tokens/primitives/shadow.json",
        "tokens/primitives/z-index.json",
        "tokens/primitives/motion.json",
        "tokens/semantic.json"
      ]
    }
  ],
  "modifiers": [
    { "name": "theme", "values": [{ "name": "slate", "values": [] }], "default": "slate" },
    {
      "name": "mode",
      "values": [
        { "name": "light", "values": ["tokens/themes/slate-light.json"] },
        { "name": "dark", "values": ["tokens/themes/slate-dark.json"] }
      ],
      "default": "light"
    }
  ]
}
```

(Theme-specific files become per-theme modifier values when showcase themes land in Task 7 — the workshop decides whether theme×mode is two modifiers or composed contexts; follow the verified resolver semantics.)

- [ ] **Step 6: `terrazzo.config.mjs`** — plugin-css emitting `generated/tokens.css` with prefix `mc`, a context block per theme×mode (`:root[data-theme="slate"]`, `:root[data-theme="slate"].dark` selectors — verify the plugin's selector-templating options), and plugin-tailwind emitting `generated/tailwind-theme.css` (`@theme` populated via `@tz`).
- [ ] **Step 7: Run the build and inspect.** Run: `pnpm --filter @magna-carta/design-tokens build`. Expected: both generated files exist; `tokens.css` contains `--mc-surface-default` under both context selectors with different values. Commit generated output.
- [ ] **Step 8: Commit** — `feat(design-tokens): scaffold + provisional slate theme + Terrazzo build (ADR-0076)`.

### Task 2: Spec-purity + completeness gates

**Files:** Create: `packages/design-tokens/test/purity.test.ts`, `test/completeness.test.ts`, `src/parse-generated-css.ts`

- [ ] **Step 1: Write the shared CSS parser helper** `src/parse-generated-css.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface ContextVariables {
  /** selector → variable name → value, e.g. ':root[data-theme="slate"].dark' → '--mc-surface-default' → 'oklch(…)' */
  [selector: string]: Record<string, string>;
}

const BLOCK = /([^{}]+)\{([^{}]*)\}/g;
const DECL = /(--mc-[\w-]+)\s*:\s*([^;]+);/g;

export function parseGeneratedCss(file = "generated/tokens.css"): ContextVariables {
  const css = readFileSync(join(import.meta.dirname, "..", file), "utf8");
  const contexts: ContextVariables = {};
  for (const block of css.matchAll(BLOCK)) {
    const selector = block[1].trim();
    const declarations: Record<string, string> = {};
    for (const declaration of (block[2] ?? "").matchAll(DECL)) {
      declarations[declaration[1]] = declaration[2].trim();
    }
    if (Object.keys(declarations).length > 0)
      contexts[selector] = { ...contexts[selector], ...declarations };
  }
  return contexts;
}
```

- [ ] **Step 2: Write the failing purity test** — every file under `tokens/` parses as JSON; recursively, no key anywhere is `$extensions`; every leaf group member uses only DTCG keys (`$type`, `$value`, `$description`, `$deprecated`); `resolver.json` contains no Terrazzo-specific keys (assert absence of `tzMode`).
- [ ] **Step 3: Write the failing completeness test** — collect every token name in `tokens/semantic.json`; for each theme×mode context selector found in the generated CSS, assert every semantic variable (`--mc-<name with dots→dashes>`) is present with a non-empty value. Also assert: the set of context selectors equals the full theme×mode matrix declared in `resolver.json` (parse it — no silent missing context).
- [ ] **Step 4: Run, fix the source until green.** Run: `pnpm --filter @magna-carta/design-tokens test`. Expected: PASS (fix token files, not tests).
- [ ] **Step 5: Commit** — `test(design-tokens): spec-purity + theme-completeness gates`.

### Task 3: WCAG 2.2 contrast gate

**Files:** Create: `packages/design-tokens/src/contrast-pairs.ts`, `test/contrast.test.ts`

- [ ] **Step 1: Declare the pairings** `src/contrast-pairs.ts` — the design-language contract the gate enforces:

```ts
/** Foreground/background pairings that must clear WCAG 2.2 AA in every theme x mode. */
export const CONTRAST_PAIRS: ReadonlyArray<{
  foreground: string;
  background: string;
  minimumRatio: number;
}> = [
  { foreground: "text-default", background: "surface-default", minimumRatio: 4.5 },
  { foreground: "text-muted", background: "surface-default", minimumRatio: 4.5 },
  { foreground: "text-default", background: "surface-raised", minimumRatio: 4.5 },
  { foreground: "action-primary-foreground", background: "action-primary", minimumRatio: 4.5 },
  { foreground: "action-secondary-foreground", background: "action-secondary", minimumRatio: 4.5 },
  {
    foreground: "action-destructive-foreground",
    background: "action-destructive",
    minimumRatio: 4.5,
  },
  { foreground: "status-info-foreground", background: "status-info", minimumRatio: 4.5 },
  { foreground: "status-success-foreground", background: "status-success", minimumRatio: 4.5 },
  { foreground: "status-warning-foreground", background: "status-warning", minimumRatio: 4.5 },
  { foreground: "status-danger-foreground", background: "status-danger", minimumRatio: 4.5 },
  { foreground: "text-link", background: "surface-default", minimumRatio: 4.5 },
  // non-text UI (borders, focus ring) per WCAG 1.4.11:
  { foreground: "border-strong", background: "surface-default", minimumRatio: 3 },
  { foreground: "focus-ring", background: "surface-default", minimumRatio: 3 },
];
```

- [ ] **Step 2: Write the failing contrast test** — for every context from `parseGeneratedCss()` and every pair, parse both OKLCH values with culori (`parse`), convert to sRGB, compute the WCAG relative-luminance contrast ratio (`wcagContrast` from culori), and assert `>= minimumRatio`, with a failure message naming context, pair, and computed ratio. Compute APCA via `apca-w3` and `console.info` it (advisory — never asserted).
- [ ] **Step 3: Run; tune provisional values until green.** Expected: PASS.
- [ ] **Step 4: Commit** — `test(design-tokens): WCAG 2.2 contrast gate over every theme x mode (APCA advisory)`.

### Task 4: Golden-file gate + drift check

**Files:** Create: `packages/design-tokens/test/golden.test.ts`, `test/golden/*.css` (snapshots)

- [ ] **Step 1: Write the golden test** — copy the current `generated/*.css` into `test/golden/`; the test reads both and asserts byte equality with `generated/`, with a failure message: "Generated output changed. If intentional (token edit), update test/golden/ in the same commit and review the diff."
- [ ] **Step 2: Drift protection** — the same test re-runs the documented build precondition: assert `generated/tokens.css` mtime is not older than every file in `tokens/` (cheap local guard); the authoritative drift gate is CI running `pnpm --filter @magna-carta/design-tokens build && git diff --exit-code packages/design-tokens/generated` (wired in Phase E).
- [ ] **Step 3: Run; commit** — `test(design-tokens): golden-file pin of generated CSS`.

### Task 5: Culori theme-generation script

**Files:** Create: `packages/design-tokens/scripts/generate-theme.ts`, `test/generate-theme.test.ts`

- [ ] **Step 1: Write the failing tests** — `generateRamp({ hue, chroma })` returns 11 OKLCH stops `0–1000` with monotonically decreasing lightness, all in-gamut for sRGB (culori `displayable()` after gamut-mapping), stop 0 ≥ 0.98 L and stop 1000 ≤ 0.15 L; `generateThemeFiles({ name, brandHue, brandChroma, neutralTint })` returns the JSON objects for `<name>-light.json`/`<name>-dark.json` whose semantic overrides pass the Task 3 contrast pairs (invoke the same ratio function); determinism — same input, byte-identical output (no randomness, no clock).
- [ ] **Step 2: Implement** — pure functions; OKLCH ramp = fixed lightness ladder + per-stop chroma curve (peak mid-ramp) + constant hue, `clampChroma` for gamut; theme assembly maps semantic slots to ramp stops (one table for light, one for dark); a thin `main()` writes files under `tokens/themes/` when run with `--name <theme> --hue <deg> [--chroma n] [--tint n]`.
- [ ] **Step 3: Regenerate the provisional slate theme with the script** (replacing the hand values from Task 1), run the full package suite (purity/completeness/contrast/golden — update goldens), commit — `feat(design-tokens): Culori OKLCH theme generation; slate regenerated through it`.

### Task 6: Package docs

**Files:** Create: `packages/design-tokens/CLAUDE.md`

- [ ] **Step 1: Write the area CLAUDE.md** from the template (`docs/conventions/area-claude-template.md`): purpose (single source of design truth), key files, the invariants (spec-purity — no `$extensions`/`tzMode`; semantic tier is the only consumer contract; generated files never hand-edited; every theme×mode passes all four gates; goldens updated in the same commit as any token change), gotchas (Terrazzo pinned exact — breaking minors; resolver schema is externally owned; new semantic token = update completeness expectations + maybe contrast pairs).
- [ ] **Step 2: Commit** — `docs(design-tokens): area CLAUDE.md`.

## Phase B — design language & archetypes (owner-gated; collaborative, not autonomous)

### Task 7: Brand + design-language workshop → brand document + final flagship + showcase themes

**Files:** Create: `docs/specs/<date>-design-language.md`, `docs/specs/<date>-brand.md`; Modify: `packages/design-tokens/tokens/**`

**Inputs (read first):** [`docs/research/brand-typography-and-wordmark.md`](../research/brand-typography-and-wordmark.md) (wordmark font candidates — P22 Morris Troy the researched front-runner — licensing mechanics, monogram/favicon/Tauri deliverable checklist), [`docs/research/magna-carta-text-motif.md`](../research/magna-carta-text-motif.md) (text-motif options ranked; celebrated-excerpt hero + 1297 statute texture recommended), [`docs/research/motion-animation-stack.md`](../research/motion-animation-stack.md) (motion personality + the zero-dependency core stack, GSAP lazy for signature moments).

- [ ] **Step 1: Run the workshop with the owner** (visual companion). **Design language:** type system + scale (UI workhorse faces — distinct from the brand display face), flagship palette anchors, showcase theme anchors (2–3 themes, distinct hue families), spacing/density decision, elevation/border philosophy, **motion personality** (duration ladder + easing pair + reduced-motion scalar; where signature motion is allowed), signature elements — anchored to named best-in-class references. **Brand:** wordmark display font decision (owner picks from the researched candidates in browser — Adobe Fonts pages must be eyeballed), monogram direction (illuminated-initial MC), brand colors (these seed the flagship theme), text-motif decision (the ranked options), wordmark-animation route (DIY mask + DrawSVG vs outsource). **This step blocks on the owner; do not improvise values or brand decisions.**
- [ ] **Step 2: Encode** — write the design-language document AND the brand document (font choice + licensing record, monogram direction, text-motif decision with the version-choice rationale paragraph, motion personality, the deliverables checklist from the research doc); set typography/spacing/radius/shadow/motion primitives to the decided values; run `generate-theme` for the flagship + each showcase theme; extend `resolver.json` with the new theme contexts.
- [ ] **Step 3: All gates green; goldens updated.** Run package tests; commit — `feat(design-tokens): design language + brand encoded — flagship + showcase themes (owner-approved)`.

### Task 7b: Brand assets (after Task 7 decides; sequencing flexible — can run parallel to Phase C/D)

**Files:** Create: `apps/web/static/{favicon.svg,favicon.ico,apple-touch-icon.png}`, brand asset sources under `docs/specs/` or a `brand/` directory (workshop decides the home)

- [ ] **Step 1:** Wordmark set in the chosen face → outlined SVG (record font + version in the brand document — the Adobe Fonts license permits outlining + trademark; outlined artwork needs no ongoing license).
- [ ] **Step 2:** Monogram master (full + simplified-small + monochrome variants, reduction-first: must survive 16 px) → the three web favicon files; the 1024×1024 Tauri master PNG is produced now, consumed when the Tauri shell lands.
- [ ] **Step 3:** Wordmark writing animation — DIY route: hand-trace pen paths, mask, GSAP DrawSVG sequence as a lazy-loaded component with a reduced-motion static fallback; outsource route: hand the freelancer spec from the research doc. Either way the deliverable includes the reduced-motion variant, and the component ships with a Storybook story like everything else.
- [ ] **Step 4:** Commit — `feat(design-system,web): brand assets — wordmark, monogram, favicons (owner-approved)`.

### Task 8: Page-archetype documents

**Files:** Create: `docs/specs/<date>-page-archetypes.md`

- [ ] **Step 1: With the owner**, fix the five archetypes (List/Index, Record Detail, Editor, Form/Wizard, Dashboard): layout grammar, hierarchy, full state set (empty/loading/error/dense) — each with an ASCII/mermaid wireframe and the components it composes.
- [ ] **Step 2: Commit** — `docs(specs): page archetypes (ADR-0053)`.

## Phase C — `@magna-carta/design-system` scaffold

### Task 9: Package scaffold + class utilities + type helpers

**Files:** Create: `packages/design-system/{package.json,tsconfig.json}`, `src/lib/internal/{merge-classes.ts,types.ts}`, `test/{merge-classes,types}.test.ts`

- [ ] **Step 1: `package.json`** — dependencies `bits-ui`, `clsx`, `tailwind-merge`, `@magna-carta/design-tokens` (workspace); dev `@magna-carta/tsconfig`, `svelte`, `vitest`, `@types/node` (all `catalog:`); exports per component added as built (`"./button": "./src/lib/components/button/index.ts"`, plus `"./internal/theme-preference"`, `"./styles/components.css"`).
- [ ] **Step 2: Failing tests for `mergeClasses`** — merges and dedupes Tailwind classes (`mergeClasses("p-2", "p-4")` → `"p-4"`); **token-namespace merging**: with the extended config, `mergeClasses("rounded-md", "rounded-lg")` and custom-token utilities collide correctly; falsy inputs dropped.
- [ ] **Step 3: Implement `merge-classes.ts`**:

```ts
import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge must know every non-color token namespace or conflicting
 * utility classes silently fail to merge. Grows with the token set — keep in
 * sync with packages/design-tokens semantic + primitive groups.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      // verify against the generated tailwind-theme.css namespaces at build time
      spacing: ["gutter", "stack"],
      radius: ["none", "sm", "md", "lg", "full"],
      shadow: ["elevation-0", "elevation-1", "elevation-2", "elevation-3"],
    },
  },
});

export function mergeClasses(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 4: `types.ts`** — the four wrapper type helpers (verified against current Bits UI exports; prefer re-exporting Bits's own where provided):

```ts
export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & { ref?: U | null };
export type WithoutChildren<T> = T extends { children?: unknown } ? Omit<T, "children"> : T;
export type WithoutChild<T> = T extends { child?: unknown } ? Omit<T, "child"> : T;
export type WithoutChildrenOrChild<T> = WithoutChildren<WithoutChild<T>>;
```

- [ ] **Step 5: Tests green; commit** — `feat(design-system): scaffold + mergeClasses (token-aware) + wrapper type helpers`.

### Task 10: Tailwind v4 wiring + component-class CSS layer + apps/web integration + theme boot

**Files:** Create: `packages/design-system/src/lib/styles/components.css`, `src/lib/internal/theme-preference.ts`, `apps/web/src/app.css`; Modify: `apps/web/src/app.html`, apps/web Vite/Svelte config, `apps/web/package.json`

- [ ] **Step 1: `app.css`** in apps/web:

```css
@import "tailwindcss";
@import "@magna-carta/design-tokens/tokens.css";
@import "@magna-carta/design-tokens/tailwind-theme.css";
@import "@magna-carta/design-system/styles/components.css";
@source "../node_modules/@magna-carta/design-system/src";
```

Add `@tailwindcss/vite` to the web app's Vite plugins; import `app.css` in the root `+layout.svelte`. (Verify the `@source` path resolves through the pnpm symlink; otherwise use a relative workspace path.)

- [ ] **Step 2: `components.css`** — opens the semantic-class layer (initially just the layer declaration + a comment documenting the rule: _every value in this file is a `var(--mc-…)` reference; no literals_). Component recipes accrete per component task.
- [ ] **Step 3: `theme-preference.ts`** — the storage seam:

```ts
export type Mode = "light" | "dark" | "system";
const THEME_KEY = "magna-carta.theme";
const MODE_KEY = "magna-carta.mode";

export function readThemePreference(): { theme: string; mode: Mode } {
  return {
    theme: localStorage.getItem(THEME_KEY) ?? "slate",
    mode: (localStorage.getItem(MODE_KEY) as Mode) ?? "system",
  };
}
export function applyThemePreference(theme: string, mode: Mode): void {
  localStorage.setItem(THEME_KEY, theme);
  localStorage.setItem(MODE_KEY, mode);
  const root = document.documentElement;
  root.dataset.theme = theme;
  const dark =
    mode === "dark" || (mode === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  root.classList.toggle("dark", dark);
}
```

(Slice 0·7b swaps `localStorage` for the settings registry — this module is the only touch point.)

- [ ] **Step 4: Boot script in `app.html`** — inline, before first paint, duplicating only the read+apply logic (no import — it must be inline): set `data-theme` + `dark` class from localStorage/`prefers-color-scheme`. Mark with a comment that it mirrors `theme-preference.ts`.
- [ ] **Step 5: Smoke-verify** — `vp dev` on apps/web; toggling `document.documentElement.dataset.theme` and the `dark` class in devtools restyles a probe element using `bg-[color:var(--mc-surface-default)]`-free token utilities (use a real utility, e.g. `bg-surface`). Commit — `feat(design-system,web): Tailwind v4 + token wiring + theme boot (data-theme + mode class)`.

### Task 11: Storybook 10 + Vitest addon + a11y addon

**Files:** Create: `packages/design-system/.storybook/{main.ts,preview.ts}`; Modify: `packages/design-system/package.json` (scripts `storybook`, `storybook-build`)

- [ ] **Step 1: Verify current Storybook + svelte-csf setup docs**; install `storybook`, `@storybook/svelte-vite` (or `@storybook/sveltekit` if it tolerates the package context better), `@storybook/addon-svelte-csf`, `@storybook/addon-a11y`, `@storybook/addon-vitest` per catalog pins. Confirm Storybook boots under the repo's `vite` → `@voidzero-dev/vite-plus-core` override (Decided-up-front 9); record the resolution if it needs one.
- [ ] **Step 2: `preview.ts`** — import the three CSS files (tokens, tailwind theme, components.css); add a **global toolbar control for theme and mode** that sets `data-theme`/`dark` on the preview `<html>`; default to flagship/light.
- [ ] **Step 3: A smoke story** (`src/stories/tokens.stories.svelte`) rendering swatches of the semantic palette — proves end-to-end CSS plumbing inside Storybook, and gives VRT its first subject.
- [ ] **Step 4: Wire `addon-vitest`** so stories run as browser-mode tests via `pnpm --filter @magna-carta/design-system test`; `addon-a11y` runs axe per story in that same pass (fail, not warn).
- [ ] **Step 5: Commit** — `feat(design-system): Storybook 10 catalog + per-story vitest/axe wiring + theme toolbar`.

### Task 12: CSP spike — Dialog under strict `style-src` (week-1 risk task)

**Files:** Create: `packages/design-system/test/csp-spike/` (throwaway harness, kept as documentation)

- [ ] **Step 1: Build the probe** — a minimal page serving Bits `Dialog` with `Content-Security-Policy: style-src 'self'` (no `unsafe-inline`), via a tiny Vite preview config; open the dialog; capture console CSP violations.
- [ ] **Step 2: Record the outcome in the spec's risk register and the package CLAUDE.md.** Expected (per open bits-ui #1995): scroll-lock inline styles violate. Decide and document the mitigation now: upstream PR / scoped patch (pnpm patch) / a `style-src` hash/nonce allowance — whichever, it must be decided **before Tier 3 components build**.
- [ ] **Step 3: Commit** — `test(design-system): CSP style-src spike — Dialog scroll-lock verdict (bits-ui #1995)`.

### Task 13: Internal floating/presence wrapper + z-scale

**Files:** Create: `packages/design-system/src/lib/internal/floating.ts` (+ `FloatingContent.svelte` if a component shell earns it), `test/floating.test.ts`

- [ ] **Step 1: Read the Bits transition + child-snippet docs** (`bits-ui.com/docs/transitions`, `…/child-snippet`).
- [ ] **Step 2: Implement** the one shared pattern every floating part uses: helpers exporting (a) the standard `data-[state=open]`/`data-[state=closed]` animation classes built on `--mc-duration-*`/`--mc-easing-*` tokens, (b) the documented two-level composition rule as a typed helper signature (outer `wrapperProps` spread unstyled; inner styled), (c) the z-scale class map `{ dropdown: "z-dropdown", modal: "z-modal", toast: "z-toast", … }` from token utilities — the only place z appears.
- [ ] **Step 3: Unit-test** the class maps (pure data) + commit — `feat(design-system): floating/presence pattern + token z-scale (the only z home)`.

### Task 14: Visual-regression harness (Playwright × theme×mode over the catalog)

**Files:** Create: `packages/design-system/visual-regression/{playwright.config.ts,catalog.spec.ts}`; Modify: package scripts

- [ ] **Step 1: Implement** — `catalog.spec.ts` reads the static Storybook build's `index.json`, and for every story × every theme × both modes: navigate `iframe.html?id=<story>&globals=theme:<t>;mode:<m>`, wait for fonts (`document.fonts.ready`) and network idle, disable animations (`reducedMotion: 'reduce'` + a global CSS override), `expect(page).toHaveScreenshot(\`${story}-${t}-${m}.png\`, { maxDiffPixelRatio: 0.001 })`.
- [ ] **Step 2: Determinism discipline** — baselines are generated ONLY inside the pinned Playwright Docker image (`mcr.microsoft.com/playwright:<pinned>-noble`); the npm script `visual-regression:update` runs the container; document that local non-Docker runs are advisory.
- [ ] **Step 3: Generate baselines for the smoke story; commit** — `test(design-system): visual-regression harness across theme x mode (pinned Docker baselines)`.

### Task 15: Fitness functions (the lint contract)

**Files:** Create: `packages/design-system/test/fitness/{off-token.test.ts,boundaries.test.ts}`

- [ ] **Step 1: Write `off-token.test.ts`** — glob `apps/web/src/**/*.{svelte,ts}` + `packages/design-system/src/**/*.{svelte,ts,css}` and assert zero matches for: Tailwind arbitrary values (`/\b[\w-]+-\[[^\]]+\]/` — allow a documented escape comment `/* fitness-allow: … */` requiring justification), raw hex/rgb/hsl/oklch literals outside `packages/design-tokens` (`/#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(|oklch\(/`), raw z utilities (`/\bz-\d+\b/`).
- [ ] **Step 2: Write `boundaries.test.ts`** — assert no file outside `packages/design-system` imports `bits-ui`; no file anywhere imports `@lucide/svelte` bare (must match `@lucide/svelte/icons/`); `components.css` contains no literal color/length values (every declaration value is `var(--mc-` or a CSS keyword).
- [ ] **Step 3: Green; commit** — `test(design-system): off-token + boundary fitness functions (golden rule 2, machine-checked)`.

## Phase D — components (tiered; exemplars are normative)

> Every component task follows the same loop, shown fully in the four exemplars: **(1)** read the component's current Bits UI doc page (parts, data attributes, CSS variables); **(2)** write the story file covering every variant × state; **(3)** write behavior assertions (Vitest addon play functions or component tests) — they fail; **(4)** implement the wrapper parts + the `mc-*` recipe classes in `components.css` (token vars only); **(5)** per-story axe passes; **(6)** regenerate VRT baselines (Docker) — review the diff is only the new component; **(7)** commit `feat(design-system): <component>`. A batch ends with a **manual screen-reader pass** (NVDA) over the batch's stories and a note in the PR/commit, **and an owner design review in Storybook** — the ADR-0053 critique gate: the owner walks the batch's stories across theme×mode in the running catalog (`pnpm --filter @magna-carta/design-system storybook`) and signs off or files changes before the next tier starts; VRT baselines re-pin after any change.

### Task 16: Button — Tier 1 exemplar (full pattern)

**Files:** Create: `src/lib/components/button/{button.svelte,index.ts}`, `src/stories/button.stories.svelte`; Modify: `src/lib/styles/components.css`, `package.json` exports

- [ ] **Step 1: Story first** (`button.stories.svelte`, svelte-csf v5 `defineMeta` API — verify current syntax): stories for each variant (`primary`, `secondary`, `destructive`, `ghost`, `link`) × size (`sm`, `default`, `lg`, `icon`), plus `disabled`, `loading` (if designed), and an `href` (anchor) story. Play-function assertions: renders `<button type="button">` by default, `<a>` when `href` given; `disabled` blocks click handlers; focus-visible ring appears on keyboard focus.
- [ ] **Step 2: Run story tests — fail** (`pnpm --filter @magna-carta/design-system test`).
- [ ] **Step 3: Implement `button.svelte`** (no Bits — native element):

```svelte
<script lang="ts">
  import type { HTMLAnchorAttributes, HTMLButtonAttributes } from "svelte/elements";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import { buttonClasses, type ButtonSize, type ButtonVariant } from "./variants.ts";

  type Props = { variant?: ButtonVariant; size?: ButtonSize; ref?: HTMLElement | null } & (
    | ({ href: string } & HTMLAnchorAttributes)
    | ({ href?: never } & HTMLButtonAttributes)
  );
  let { variant = "primary", size = "default", ref = $bindable(null), class: className, children, ...restProps }: Props = $props();
</script>

{#if "href" in restProps && restProps.href}
  <a bind:this={ref} class={mergeClasses(buttonClasses({ variant, size }), className)} {...restProps}>{@render children?.()}</a>
{:else}
  <button bind:this={ref} type="button" class={mergeClasses(buttonClasses({ variant, size }), className)} {...restProps}>{@render children?.()}</button>
{/if}
```

`variants.ts` — the plain typed variant function (the house pattern, no DSL):

```ts
export type ButtonVariant = "primary" | "secondary" | "destructive" | "ghost" | "link";
export type ButtonSize = "sm" | "default" | "lg" | "icon";

const VARIANT: Record<ButtonVariant, string> = {
  primary: "mc-button-primary",
  secondary: "mc-button-secondary",
  destructive: "mc-button-destructive",
  ghost: "mc-button-ghost",
  link: "mc-button-link",
};
const SIZE: Record<ButtonSize, string> = {
  sm: "mc-button-sm",
  default: "mc-button-md",
  lg: "mc-button-lg",
  icon: "mc-button-icon",
};

export function buttonClasses(options: { variant: ButtonVariant; size: ButtonSize }): string {
  return `mc-button ${VARIANT[options.variant]} ${SIZE[options.size]}`;
}
```

`components.css` gains the recipe (every value a token var — the fitness test enforces it):

```css
.mc-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--mc-space-2);
  border-radius: var(--mc-radius-md);
  font-size: var(--mc-text-sm);
  font-weight: var(--mc-weight-medium);
  transition: background-color var(--mc-duration-fast) var(--mc-easing-standard);
  outline-offset: 2px;
}
.mc-button:focus-visible {
  outline: 2px solid var(--mc-focus-ring);
}
.mc-button:disabled {
  background: var(--mc-action-disabled);
  color: var(--mc-action-disabled-foreground);
  pointer-events: none;
}
.mc-button-primary {
  background: var(--mc-action-primary);
  color: var(--mc-action-primary-foreground);
}
.mc-button-primary:hover {
  background: var(--mc-action-primary-hover);
}
.mc-button-primary:active {
  background: var(--mc-action-primary-active);
}
/* …secondary/destructive/ghost/link, sm/md/lg/icon heights from --mc-control-* … */
```

- [ ] **Step 4: Tests + axe green; VRT baselines regenerated (Docker); commit** — `feat(design-system): Button (Tier 1 exemplar)`.

### Task 17: Tier 1 batch — Input, Textarea, Label, Badge, Card, Separator, Skeleton, Alert, Kbd

**Files:** per component as in Task 16

- [ ] One sub-task per component, exactly the Task 16 loop (story → fail → implement native element + `mc-*` recipe → green → VRT → commit). Notes: `Input` follows the file-type-narrowing pattern; `Alert` consumes `status.*` tokens with `role="alert"` (or `role="status"` for info — assert in play function); `Skeleton` uses `motion` tokens with `prefers-reduced-motion` guard.
- [ ] **Batch close: NVDA pass** over all Tier 1 stories; note findings; commit fixes.

### Task 18: Tabs — Tier 2 exemplar (single Bits primitive)

**Files:** Create: `src/lib/components/tabs/{tabs.svelte,tabs-list.svelte,tabs-trigger.svelte,tabs-content.svelte,index.ts}`, story; Modify: `components.css`

- [ ] **Step 1: Read the Bits Tabs docs** — parts (`Tabs.Root/List/Trigger/Content`), their data attributes (`data-state="active|inactive"`, `data-disabled`, part identifiers).
- [ ] **Step 2: Story + behavior assertions (fail):** arrow-key navigation between triggers; `data-state="active"` styling visible; disabled trigger skipped.
- [ ] **Step 3: Implement** — each part file is the thin wrapper idiom (the same shape for every Tier 2+ component):

```svelte
<!-- tabs-trigger.svelte -->
<script lang="ts">
  import { Tabs as TabsPrimitive } from "bits-ui";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithoutChild } from "../../internal/types.ts";

  let { ref = $bindable(null), class: className, ...restProps }: WithoutChild<TabsPrimitive.TriggerProps> = $props();
</script>

<TabsPrimitive.Trigger bind:ref class={mergeClasses("mc-tabs-trigger", className)} {...restProps} />
```

with `components.css` recipes targeting `.mc-tabs-trigger[data-state="active"]` etc.; `index.ts` exports `Root, List, Trigger, Content` plus a `Tabs` namespace object.

- [ ] **Step 4: Green + axe + VRT + commit** — `feat(design-system): Tabs (Tier 2 exemplar)`.

### Task 19: Tier 2 batch — Checkbox, Switch, RadioGroup, Accordion, Tooltip, Avatar, Progress

- [ ] Per component, the Task 18 loop against its own Bits doc page. Notes: `Tooltip` needs `Tooltip.Provider` at the catalog/app root (add to Storybook preview + document for apps); `Checkbox`/`Switch`/`RadioGroup` play functions assert keyboard toggling + form value semantics. **Batch close: NVDA pass.**

### Task 20: Dialog — Tier 3 exemplar (portal/floating family)

**Files:** Create: `src/lib/components/dialog/…` (Root, Trigger, Portal, Overlay, Content, Title, Description, Close + index), story; Modify: `components.css`

- [ ] **Step 1: Bits Dialog docs** + apply the Task 12 CSP verdict (patched scroll-lock / allowance — whichever was decided).
- [ ] **Step 2: Story + assertions (fail):** open/close via trigger + Escape; focus trapped and returned to trigger; overlay click closes; `aria-labelledby`/`describedby` wired (axe asserts).
- [ ] **Step 3: Implement** — `dialog-content.svelte` composes Portal + Overlay + Content with the Task 13 presence classes (`data-[state=open]` animation tokens, `z-modal` from the z map), a default Close button (Lucide `x` via deep import); overlay uses `--mc-surface-overlay`.
- [ ] **Step 4: Green + axe + VRT + commit** — `feat(design-system): Dialog (Tier 3 exemplar; CSP verdict applied)`.

### Task 21: Tier 3 batch — AlertDialog, Sheet, Popover, DropdownMenu, Toast

- [ ] AlertDialog/Sheet/Popover/DropdownMenu: the Task 20 loop (Sheet = Dialog variant sliding from an edge; DropdownMenu asserts full keyboard menu interaction). Toast: wrap **svelte-sonner** — a `Toaster.svelte` styled via its CSS-variable/class hooks to `mc-*` recipes + a typed `toast` re-export; stories cover the `status.*` intents. **Batch close: NVDA pass.**

### Task 22: Select — Tier 4 exemplar (composition-heavy)

**Files:** Create: `src/lib/components/select/…` (Root, Trigger, Content, Item, Group, Label, ScrollUp/DownButton + index), story; Modify: `components.css`

- [ ] **Step 1: Bits Select docs** — note `--bits-select-anchor-width`/`-available-height` CSS variables, `data-placeholder`, `data-highlighted`, `data-selected`, and the open keyboard issues (#2049/#1858) — write regression stories for both behaviors so upstream fixes are observable.
- [ ] **Step 2: Story + assertions (fail):** single + multiple; typeahead; keyboard open/navigate/select; long list scroll buttons; form value via hidden input.
- [ ] **Step 3: Implement** — content sized `min-width: var(--bits-select-anchor-width)`; `z-dropdown`; recipes for trigger/item states from semantic tokens.
- [ ] **Step 4: Green + axe + VRT + commit** — `feat(design-system): Select (Tier 4 exemplar)`.

### Task 23: Command + Combobox (+ the virtualization wrapper)

- [ ] **Command:** Bits Command per docs (replaceable filter — wire a plain `includes` matcher now, indexed matcher seam later); stories incl. a 500-item perf story.
- [ ] **Virtualization wrapper:** `src/lib/internal/virtual-list.svelte` over **virtua** (Svelte 5 export), typed for item snippets; unit test renders 10,000 items with bounded DOM node count.
- [ ] **Combobox:** Bits Combobox with consumer-controlled `$derived` filtering; a virtualized story at 10,000 items composing the wrapper inside `Combobox.Content` (the matter-picker shape); keyboard nav asserted across virtualized boundaries (the fixed #1696 behavior — regression story).
- [ ] Green + axe + VRT + commit per component.

### Task 24: Calendar + DatePicker + DateRangePicker

- [ ] Bits Calendar/DatePicker/DateRangePicker per docs; **all value props typed `CalendarDate`** (Decided-up-front 12); stories: month navigation, range selection, disabled dates, keyboard grid navigation; recipes for cell states (`data-selected`, `data-outside-month`, `data-today`). Green + axe + VRT + commit.

### Task 25: Form field family

- [ ] **formsnap + superforms** field components (`Field`, `Control`, `FieldErrors`, `Description`) wrapping our Input/Select/Checkbox/DatePicker so `name`/`id`/aria wiring is automatic; Select/DatePicker use the hidden-input pattern; contracts typed against **Standard Schema** (zod 4 from the catalog as the test schema). Stories: a complete form with validation errors (axe asserts error association). Green + commit.

### Task 26: DataTable (table-core + in-house adapter)

- [ ] `src/lib/components/data-table/` — a thin Svelte 5 adapter over `@tanstack/table-core` (state in runes: `createTable` wrapped in `$state`/`$derived`, the shape the shadcn-svelte recipe proves; swap to official `@tanstack/svelte-table` v9 when stable — seam comment); column defs typed; sorting + row selection + column visibility; dense row recipe from `density.*` tokens; stories: 100-row dense table (the load-profile look), empty state, loading skeleton state. Green + axe + VRT + commit.

### Task 27: App shell — Sidebar + resizable panes

- [ ] **Sidebar:** hand-built on Collapsible + Tooltip per the archetype document (Task 8) — collapsed/expanded, keyboard navigable, `nav`/landmark semantics. **Resizable:** wrap **paneforge** (PaneGroup/Pane/Resizer) with `mc-*` recipes. Stories for both; the sidebar story is the first archetype-composition proof. Green + axe + VRT + NVDA pass + commit.

## Phase E — CI, enforcement wiring, docs

### Task 28: CI wiring

**Files:** Modify: `.github/workflows/ci.yml`

- [ ] **Step 1:** Add to CI: the token drift gate (`pnpm --filter @magna-carta/design-tokens build && git diff --exit-code packages/design-tokens/generated`); Storybook static build; the VRT job running in the pinned Playwright container over the static build (fail on diff; artifacts uploaded on failure).
- [ ] **Step 2:** Confirm `vp test` picks up both new packages in the root run; `pnpm check` green at root.
- [ ] **Step 3: Commit** — `ci: token drift gate + storybook build + visual regression in pinned container`.

### Task 29: Documentation close-out (same-commit rule)

**Files:** Modify: `docs/conventions/ui-design.md`, `ROADMAP.md`, `CHANGELOG.md`; Create: `packages/design-system/CLAUDE.md`

- [ ] **Step 1:** Promote `ui-design.md` from stub to the practitioner standard: how to add a token / author a theme (generation script), how to build a component (the Task 16/18/20/22 loop, the wrapper idiom, the recipe-class rule), the review rules a machine can't check (no styled raw HTML outside the package; archetype conformance), the definition of done (story + behavior + axe + NVDA batch pass + VRT).
- [ ] **Step 2:** `packages/design-system/CLAUDE.md` from the area template: purpose, key files, invariants (token vars only in `components.css`; two-level floating rule; z only via the token map; `CalendarDate` only; bits-ui never imported outside), gotchas (CSP verdict, virtua wrapper required past ~200 items, Tooltip.Provider).
- [ ] **Step 3:** ROADMAP (slice 0·7a → shipped summary), CHANGELOG `[Unreleased]` entry. Commit — `docs: slice 0·7a close-out — ui-design standard, area CLAUDE.md, roadmap/changelog`.

---

## Self-review checklist (run before declaring the plan done)

- Spec coverage: §1 packages (Tasks 1, 9) · §2 token tiers/theming/pipeline/gates (1–5) · §3 component layer (9–27) · §4 satellites (21, 23–27) · §5 design language/archetypes (7–8) · §6 catalog/testing/enforcement (11, 14–15, 28) · §7 risks (0 versions, 12 CSP, 14 Docker determinism) · §8 out-of-scope respected (no charts, no density toggle, localStorage seam documented).
- Every component task names its Bits doc-verification step; no component code is copied blind from exemplars.
- Type names consistent: `mergeClasses`, `buttonClasses`, `WithoutChild`, `theme-preference` module, `mc-` class prefix, `--mc-` variable prefix throughout.
