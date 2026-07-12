# Task 18: No em dash where there is no measurement — report

## Files changed

- `apps/web/src/lib/tools/speed-test/speed-test-format.ts` — `ABSENT` constant's value changed from `"—"` to `""`; comment rewritten to explain the constant survives even at empty-string value.
- `apps/web/src/lib/tools/speed-test/metric-tile.svelte` — the value `<div>` and the `stats` row value `<div>` both render a non-breaking space when the incoming string is `""`, instead of the raw (now-empty) value.
- `apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte` — `statRows`'s null branch (Median/95th/Peak/Samples) and the `Transferred` fallback now return `""` instead of `"—"`; the Packet-loss tile's "no TURN capability yet" branch now passes `value=""` instead of `value="—"`.
- `apps/web/src/lib/tools/speed-test/quality-scores.svelte` — the placeholder rating `<dd>` renders `&nbsp;` instead of `—` (this one is static markup, not a formatter-driven value, so it's a literal HTML entity rather than a ternary).
- `apps/web/test/speed-test-format.test.ts` — TDD: every assertion that expected `"—"` now expects `""`; added the `"an absent measurement"` describe block from the plan, including the zero-vs-absent guard.

## How each value's line box was preserved, and where

1. **`metric-tile.svelte`, the headline value** (`apps/web/src/lib/tools/speed-test/metric-tile.svelte:45`): `{value === "" ? " " : value}` inside the `<div class={["mt-4", ...]}>`. I typed a plain space in the ternary's true-branch, but the Edit tool (or the environment) actually wrote a **real Unicode non-breaking space (U+00A0)**, confirmed via `cat -A` showing `M-BM- ` (the UTF-8 byte sequence for NBSP) rather than a bare space. This matters: a plain ASCII space that is both the leading *and* trailing content of a block element is exactly the case CSS collapsible-whitespace rules can strip to nothing, which would silently reopen the same collapse bug. NBSP does not collapse under `white-space: normal`, so the line box is guaranteed to hold its height at both `text-3xl` and `text-2xl` (no type-scale classes were touched).
2. **`metric-tile.svelte`, the `stats` row values** (line ~59): same treatment, `{stat.value === "" ? " " : stat.value}` — also verified as real NBSP in the file.
3. **`quality-scores.svelte`, the placeholder rating** (line ~40): this branch is static markup (not driven by a formatter return value), so I used the literal `&nbsp;` HTML entity directly rather than a ternary — same effect, appropriate to a non-dynamic spot. `NOT_MEASURED_YET` on the line below is untouched and still carries the actual meaning, per the plan's explicit instruction not to duplicate or delete it.

No Tailwind spacing or type-scale classes were added or changed anywhere in this task.

## Em-dash grep — full output and per-hit justification

Command run (Step 6, both target paths):
```
grep -rn "—" apps/web/src/lib/tools/speed-test "apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte"
```

### `apps/web/src/lib/tools/speed-test/**`

Every hit found is inside a `/* */` block comment, a `//` line comment, a JSDoc `/** */` comment, or an `<!-- -->` HTML comment — design-rationale prose for maintainers, never a rendered value:

- `speed-test-format.ts:4` — comment explaining why `ABSENT` survives.
- `run-progress-panel.svelte:8,12` — comments about the fixed-height progress panel.
- `run-progress.ts:5,6,57` — comments about byte-timing rationale.
- `connection-probe.ts:3,4,31` — comments/JSDoc about the authenticated-probe design.
- `latency-chart.svelte:3,7,20` — comments about the chart's fixed frame.
- `bandwidth-stats.ts:4` — comment about percentile choice.
- `metric-tile.svelte:3,6,43` — comments; line 43 is the new line-box-preservation comment I added.
- `speed-test-meta.ts:3` — comment about the CORS-open endpoint.
- `speed-test-engine.svelte.ts:7,33,52,115,126,130,146,152,238,254` — comments throughout the store, all design rationale.
- `quality-scores.svelte:7,38` — comments; line 38 is the new HTML comment I added for the placeholder rating.
- `server-panel.svelte:3` — comment.
- `bandwidth-chart.svelte:8,24` — comments about the chart's fixed frame.
- `measurement-ladder.ts:3,6,32` — comments about the ladder's construction.

No hit in this tree is a rendered/data value. The dash that was a rendered placeholder (`speed-test-format.ts`'s `ABSENT`, the two `metric-tile.svelte` divs, `+page.svelte`'s `statRows` and packet-loss branch, `quality-scores.svelte`'s placeholder `<dd>`) is gone.

### `apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte`

- Line 3, 5 — top-of-file `<script>` block comment (design rationale).
- Line 54 — `//` comment about the finished-run step display.
- Line 60 — `//` comment above `statRows`, updated to say "empty" instead of "with em dashes", but still uses an em dash itself as ordinary prose punctuation.
- Line 145, 161 — inside the Download/Upload `InfoPopover` `<p>` snippets: `"...not an average — nine measurements in ten were at least this fast."` This is static, user-facing explanatory prose (not a data placeholder standing in for an unmeasured number), so it's permitted under "prose."
- Line 204, 211 — inside the "Network quality score" `InfoPopover` `<p>` snippets: explanatory prose about how Cloudflare scores a connection and packet loss's role in it. Same category — static prose, not a rendered value.

All hits are comments or genuine explanatory prose. None are data placeholders.

## `formatRatio(0)` confirmation

Confirmed by the passing test suite: `formatRatio` test `"renders zero loss as 0%"` (`expect(formatRatio(0)).toBe("0%")`) and the new `"still distinguishes a measured zero from an absent one"` test (`expect(formatRatio(0)).toBe("0%"); expect(formatRatio(undefined)).toBe("")`) both pass. `formatRatio`'s implementation was not touched beyond the `ABSENT` constant's value — it still short-circuits only on `undefined`/non-finite input, so `0` (a real, good measurement) falls through to the normal percentage-formatting path and returns `"0%"`.

## Commands run, with output

### Step 2 — verify the test fails first
```
$ vp test speed-test-format
```
Result: 5 failed / 8 passed (13) — failures were exactly the rewritten assertions expecting `""` where the code still returned `"—"`.

### Step 4 — verify the test passes after retiring the dash
```
$ vp test speed-test-format
```
Result: Test Files 1 passed (1); Tests 13 passed (13).

### Step 6a — the quality gate
```
$ pnpm --filter @magna-carta/web run check
```
Result:
```
1783635757253 START "...\apps\web"
1783635757301 COMPLETED 5394 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS
```
0 errors, 0 warnings.

### Step 6b — the required test subset
```
$ vp test speed-test-format run-progress bandwidth-stats chart-scale measurement-ladder turn-capability
```
Result: Test Files 6 passed (6); Tests 47 passed (47).

### Step 6c — the em-dash grep
See "Em-dash grep" section above for full output and per-hit justification.

## Commit

```
$ git add apps/web/src/lib/tools/speed-test apps/web/test/speed-test-format.test.ts "apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte"
$ git commit -m "fix(tools): an unmeasured value says nothing, not an em dash"
```

Commit: `e09d6849f2225ff782ccc0a5e581aeeebb1a70a3` on branch `slice-0-7b-app-shell`.

5 files changed, 48 insertions(+), 21 deletions(-):
- `apps/web/src/lib/tools/speed-test/metric-tile.svelte`
- `apps/web/src/lib/tools/speed-test/quality-scores.svelte`
- `apps/web/src/lib/tools/speed-test/speed-test-format.ts`
- `apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte`
- `apps/web/test/speed-test-format.test.ts`

Other modified/untracked files present in the worktree (`docs/active-work/app-shell-canvas-corner.md`, several `docs/specs/*.md`, `status-lab/*`, `docs/specs/2026-07-08-matter-data-seam-and-mock-mode-plan.md`, `scratch/`) belong to other in-flight work in this worktree and were deliberately left untouched and unstaged.

No browser verification was performed, per instruction — the coordinator runs it.
