# @magna-carta/design-tokens — CLAUDE.md

**Purpose.** The single source of design truth: DTCG 2025.10 tokens, a resolver-based theme
gallery crossed with light/dark mode, and a Terrazzo build to CSS custom properties plus a
Tailwind `@theme` file. Everything visual downstream consumes this package's generated output;
nothing visual is defined anywhere else.

**White paper:** _Design system, UI consistency & design quality_ —
[`docs/Magna-Carta-White-Paper.md`](../../docs/Magna-Carta-White-Paper.md). (ADR-0076.)
**Spec:**
[`docs/specs/2026-06-10-design-system-foundation-design.md`](../../docs/specs/2026-06-10-design-system-foundation-design.md).

## Key files / entry points

- `tokens/primitives/` — primitive tokens; the color ramps are generated via
  `scripts/generate-theme.ts` — never hand-drift neutral/brand: a pin test holds them byte-equal
  to the generator's slate output
- `tokens/semantic.json` — the light-mode truth; aliases only, never raw values
- `tokens/modes/dark.json` — the shared dark overlay: re-points ramp POSITIONS; themes swap ramp
  VALUES only — the semantic mapping never varies per theme
- `resolver.json` — the single Terrazzo entry point; declares the theme and mode modifiers
- `terrazzo.config.mjs` + `tailwind.template.css` — build config and the hand-authored
  `@theme inline` block
- `generated/` — committed build output; never hand-edited
- `src/contrast-pairs.ts` — the workshop-owned contract of foreground/background pairings the
  contrast gate enforces
- `scripts/generate-theme.ts` — OKLCH ramp generation from anchors, contrast/gamut
  pre-validation, and the `--validate` re-check path
- `test/` — the five gates: `purity.test.ts`, `completeness.test.ts`, `contrast.test.ts`,
  `golden.test.ts`, `generate-theme.test.ts`

## Invariants that apply here

- **Spec purity.** No `$extensions`, no `tzMode` — DTCG 2025.10 only (purity gate).
- **Completeness.** Every theme-and-mode context resolves every semantic token (completeness
  gate).
- **Contrast.** Every pair in `src/contrast-pairs.ts` clears WCAG 2.2 AA in every theme-and-mode
  context of `generated/tokens.css` (contrast gate). WCAG 2.2 AA is the only asserted threshold.
  (An APCA Lc advisory report previously rode alongside it, but its `apca-w3`/`colorparsley`
  dependency is AGPL/Limited-W3 — disallowed for this proprietary SaaS by the license gate — so it
  was dropped. Re-add an advisory only via a permissively-licensed or in-house APCA implementation.)
- **Goldens move with tokens.** Any token change updates the goldens in the SAME commit, with the
  diff reviewed — a golden update is a design decision, not noise.
- **No drift.** Committed `generated/` output byte-matches a fresh `tz build` (CI regenerates and
  diffs).
- **Tailwind mapping.** Every semantic color token has its `@theme inline` mapping in
  `tailwind.template.css` (gated).
- **Explicit types.** Every token with a `$value` carries its own `$type` (gated).

## Dependencies & contracts

- Dev-only dependencies: Terrazzo (CLI + CSS/Tailwind plugins), culori. Nothing here ships runtime
  JavaScript.
- Exports: `tokens.css`, `tailwind-theme.css`, and `contrast-pairs`.
- Consumers: `@magna-carta/design-system` (not yet created) and `apps/web-worker`.

## Gotchas

- Terrazzo is pinned exact — breaking changes have shipped in minor versions.
- plugin-tailwind inlines resolved alias targets (freezing semantic colors to light mode), which
  is why the semantic mappings are hand-authored in `tailwind.template.css`'s `@theme inline`
  block instead of the plugin's `theme.color` mapping.
- The plugin's `template` path resolves relative to `outDir`, hence the leading `../`.
- `generated/**` and `test/golden/**` are formatter-exempt (root `vite.config.ts`
  `fmt.ignorePatterns`) — never "fix" their formatting.
- pnpm forwards a literal `--` separator to scripts; `generate-theme` tolerates one leading
  occurrence.
- New theme = `tokens/themes/<name>.json` (ramp values only, produced via the generator) + one
  entry in the `themes` array of `terrazzo.config.mjs` + the resolver context.
- Adding a semantic color token touches `tokens/semantic.json` + `tailwind.template.css`, and
  possibly `src/contrast-pairs.ts` if it participates in a foreground/background pairing.
