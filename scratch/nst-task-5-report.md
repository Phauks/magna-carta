# Task 5 report — Network Speed Test measurement charts

## Status

Done. Committed as `3e1e5ea`.

## Files created

- `apps/web/src/lib/tools/speed-test/chart-scale.ts` — `niceMax` / `scaleLinear`, pure, no browser globals.
- `apps/web/src/lib/tools/speed-test/bandwidth-chart.svelte` — single-series bar chart with SVG `<title>` tooltips and a `<details>` table view.
- `apps/web/src/lib/tools/speed-test/latency-chart.svelte` — single-series point chart (small multiple), same tooltip/table pattern.
- `apps/web/test/chart-scale.test.ts` — the failing-then-passing TDD test (6 tests) for the scale module.

## Files modified

- `apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte` — added three new sections at the bottom of the page, after "Your connection":
  1. **Latency measurements** — three `LatencyChart` small multiples (Idle / During download / During upload) in a `grid-cols-1 lg:grid-cols-3`.
  2. **Download measurements** — one `BandwidthChart`.
  3. **Upload measurements** — one `BandwidthChart`.

  This is a deliberate deviation from the plan's literal Task 5 Step 7 (which combined download+upload into one "Bandwidth measurements" section with two charts side by side) per the coordinator's explicit instruction to match speed.cloudflare.com's three-section layout instead. Each `<h2>` reuses the exact sibling-section markup verbatim (`mb-16 border-b border-border-strong pb-8 text-xs text-text-muted uppercase` + `style="letter-spacing: var(--mc-tracking-caps)"`) — no new heading classes were invented.

## Colour token

`var(--mc-accent-default)` — used as the SVG `fill` on both the bandwidth bars and the latency points (the only mark colour in either chart; axes/labels use `text-text-muted`, never the series colour).

Verified it exists and is theme-aware (not an automatic light/dark flip) by grepping `packages/design-tokens/generated/tailwind-theme.css` (maps `--color-accent-default: var(--mc-accent-default)`) and `packages/design-tokens/generated/tokens.css`, where `--mc-accent-default` is redefined per theme block (alternates between `var(--mc-color-accent-700)` and `var(--mc-color-accent-400)` across the file's several theme blocks) — i.e. it already resolves correctly under both light and dark surfaces via the app's existing theming system, not a `prefers-color-scheme` auto-flip.

## Table view

Both charts render an SVG (bars/points with a per-mark `<title>` tooltip) followed by a `<details><summary>Table view</summary>...</details>` disclosure:

- `bandwidth-chart.svelte`: a `<table>` with Transfer (kB) / Speed columns, one row per point.
- `latency-chart.svelte`: an `<ol>` with one `formatMilliseconds` value per sample.

Neither chart conveys a value by geometry alone — it's stated via the `<title>` tooltip, the SVG `aria-label` summary, and the table/list.

## Empty-series / no-crash handling

`niceMax([])` and `niceMax([0,0])` both return `1`, so `scaleLinear` never divides by zero. Both chart components also short-circuit to a "Not measured yet." message when `points.length === 0`, so the SVG/table only render once there's data — `Math.max(...points)` spreads are guarded behind that same length check (extra `$derived` peak values added beyond the plan's inline version, purely defensive, still guarded).

## Commands run (full output trimmed to essentials)

1. `vp test chart-scale` (before implementing `chart-scale.ts`) → **FAIL**, "Cannot find module '../src/lib/tools/speed-test/chart-scale.ts'" — confirms the TDD red step.
2. Implemented `chart-scale.ts`.
3. `vp test chart-scale` → **PASS**, 1 file / 6 tests.
4. Wrote `bandwidth-chart.svelte` and `latency-chart.svelte`; validated both individually with `mcp__plugin_svelte_svelte__svelte-autofixer` (desired_svelte_version 5) → `{"issues":[],"suggestions":[]}` for both.
5. Mounted the three sections on `+page.svelte`; validated the full file with the autofixer → `{"issues":[],"suggestions":[]}`.
6. `pnpm --filter @magna-carta/web run check` → `COMPLETED 5381 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS`.
7. `vp test chart-scale speed-test-format connection-probe turn-capability measurement-ladder` → **PASS**, 5 files / 35 tests.
8. `git add` the five intended paths (verified via `git status --short` that the two unrelated pre-existing untracked items — `docs/specs/2026-07-08-matter-data-seam-and-mock-mode-plan.md` and `scratch/` — were left untouched).
9. `git commit -m "feat(tools): single-series bandwidth and latency charts"` → `3e1e5ea`.

## Concerns

- None blocking. The one intentional deviation from the plan's literal Task 5 Step 7 (three sections instead of one combined "Bandwidth measurements" section) was explicitly directed by the coordinator to match the current page's structure and speed.cloudflare.com's layout; noted above for visibility.
- Did not start a dev server or take screenshots, per instruction — the coordinator will do browser verification.
