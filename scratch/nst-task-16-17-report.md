# Network Speed Test — Task 16 & Task 17 report

Branch: `slice-0-7b-app-shell`. Worktree: `C:/dev/magna-carta-worktrees/slice-0-7a-design-system`.

## Commits

- `ddaec6d` — `feat(tools): a progress panel whose parts hold their places` (Task 16)
- `2a9d22b` — `fix(tools): one sentence for a measurement not taken` (Task 17)

## Task 16 — a progress panel whose parts do not shove each other

### Files changed

- `apps/web/test/run-progress.test.ts` — extended with the `LONGEST_PHASE_LABEL` describe block (TDD, written and run-to-fail before the export existed).
- `apps/web/src/lib/tools/speed-test/run-progress.ts` — added `LONGEST_PHASE_LABEL`, derived via `ALL_PHASE_LABELS.reduce(...)` over all four `phaseLabel()` outputs, never hardcoded.
- `apps/web/src/lib/tools/speed-test/run-progress-panel.svelte` — new component (created).
- `apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte` — masthead restructured, disclosure moved to a footer, `"Runs outside any matter"` dropped.

### TDD sequence

1. Added the `LONGEST_PHASE_LABEL` test (import + two `it`s) to `run-progress.test.ts`.
2. `vp test run-progress` → failed: `AssertionError: expected undefined to be 'Measuring download speed'` (export did not exist).
3. Added the derived `LONGEST_PHASE_LABEL` export to `run-progress.ts`.
4. `vp test run-progress` → 11/11 passed.

### Token classes verified against `packages/design-tokens/generated/tailwind-theme.css`

- `gap-4` → `--spacing-4: 4px` ✓
- `gap-16` → `--spacing-16: 16px` ✓
- `mt-40` → `--spacing-40: 40px` ✓
- `pt-16` → `--spacing-16: 16px` ✓
- `border-border-default` → `--color-border-default` ✓ (already used elsewhere in this file)
- `border-border-strong` → `--color-border-strong` ✓ (pre-existing usage)
- `invisible`, `tabular-nums`, `col-start-1`, `row-start-1`, `whitespace-nowrap`, `items-baseline`, `justify-between` are Tailwind core-plugin utilities, not part of the closed spacing scale, and are enabled by default — no token substitution needed.
- No `h-4` (or any height utility) was applied to `Progress` — see below.

### The `Progress` component's real height behaviour (and why no override was used)

Read `packages/design-system/src/lib/components/progress/progress.css`:

```css
.mc-progress { block-size: var(--mc-space-8); ... }        /* the track, 8px */
.mc-progress-fill { block-size: var(--mc-space-8); ... }    /* the fill, 8px, independent of the track's className */
```

`--mc-space-8` resolves to 8px. The component takes no size/variant prop (`progress.svelte` only exposes `value`, `max`, `class`, and passthrough props) and its Storybook story confirms there is no alternate height.

The plan's sample code applied `class="h-4"` (4px) to `Progress`. Tracing the cascade: `mc-progress`'s `block-size` lives in the `components` Tailwind layer; a `h-4` utility lives in the `utilities` layer, which is declared after `components` in this project's Tailwind v4 setup, so `h-4` would win **on the track only** — the `.mc-progress-fill` child's own `block-size: var(--mc-space-8)` (8px) is untouched, because that class is applied to the inner div, not merged from the caller's `class` prop. The result would be an 8px-tall fill clipped by a 4px track (`overflow: hidden`), and because the fill's own `border-radius` is computed against its *own* 8px box, the visible slice is bisected exactly at the pill's vertical midpoint — a shape the design system never intended and never tested. That is the "conflicting height" the plan told me to check for.

Since the component exposes no smaller height than its own default (8px is the only supported value, not a "large" default with a "small" alternate), I did **not** override it — `<Progress value={percent} max={100} aria-label="Test progress" />` renders at the design system's one supported height. This satisfies "prefer the design system's own smallest supported height over a raw value" literally: 8px is both the smallest and only height it supports.

### How the no-shove property was established

By construction, not by running a browser (browser verification is explicitly the coordinator's job):

1. **Counter's left edge / size's right edge.** The top row is `<div class="flex items-baseline justify-between gap-16 ...">` with two `<span>` children — the counter is the first child (flex start, i.e. the row's own left edge) and the size is the last child pinned to the row's end by `justify-between`. Neither span has margin or absolute positioning that could shift independently of the row's own box. The row itself is `w-full` implicitly (a block-level flex container inside a CSS Grid row spans the grid track's full inline size), so as long as the row's *container* width is fixed, both edges are fixed regardless of what text the spans contain — only the gap between them changes.

2. **Descriptor's left edge / panel width fixed regardless of phase.** The descriptor is rendered as two overlapping spans (`col-start-1 row-start-1` in a nested `<div class="grid">`) — one `invisible` copy of `LONGEST_PHASE_LABEL`, one visible copy of the live `phaseText`. Because `LONGEST_PHASE_LABEL` is a compile-time-fixed string (derived once, not re-derived per phase) and is guaranteed by its own test (`is at least as long as every label the engine can produce`) to be ≥ every real label, this inner grid's intrinsic (max-content) width is fixed to that one constant string's width regardless of which phase is showing. The **outer** `<div class="grid gap-4">` (the whole panel) is an intrinsically-sized flex item inside `Masthead.Actions` (`display:flex` per `masthead.css`, no `flex-grow` on the panel), so its rendered width is the max-content width of its widest row — the descriptor cell, whose width is that same fixed constant. The top counter/size row and the `Progress` bar (which merely stretches to whatever width the grid settles on, since a percentage/`w-full` width doesn't contribute to max-content sizing) do not influence the panel's width upward in ordinary cases (typical `Step N of M` / `NNN MB used` text is shorter than `Measuring download speed`). Because the panel's own width never changes across phases, its position inside `Masthead.Actions` (a `flex` row with `gap: var(--mc-space-8)` and `margin-inline-start: auto`) never changes either, and the buttons rendered immediately after it in the same flex row never move.

3. **The controls beside the panel.** `RunProgressPanel` is now the *first* child of `Masthead.Actions` in every phase; the `{#if store.phase === ...}` block that follows it only swaps which `<Button>` elements render — it never wraps or conditionally renders the panel itself. Combined with (2), the buttons' start position (immediately after the panel, `gap-8`) is invariant across phase transitions.

4. **Values across every phase, without disappearing.** The panel is unconditionally present in `Masthead.Actions` (previously it only rendered `{#if store.phase === "running"}`). Idle/paused/failed pass through `store.stepIndex`/`store.currentPhase` unchanged (the store's `pause()` and `onError` handlers never clear them). Finished is special-cased at the **page** level only (not the store, per the plan's file list) — `displayStepIndex` substitutes `stepCount - 1` when `phase === "finished"` so the counter and bar show the final step and 100%, since the store's own `onFinish` handler nulls `stepIndex`/`currentPhase` (correct for the live counter, wrong for the finished record) and I did not touch that handler, which is out of this task's file list.

### Test/check results

- `pnpm --filter @magna-carta/web run check` → `0 ERRORS 0 WARNINGS` (5391 files).
- `vp test run-progress bandwidth-stats speed-test-format chart-scale measurement-ladder turn-capability` → 6 files, 44 tests, all passed.
- `svelte-autofixer` (Svelte MCP) → clean (`issues: [], suggestions: []`) for `run-progress-panel.svelte` and the full `+page.svelte`.

## Task 17 — absence reads the same way everywhere

### Files changed

- `apps/web/test/speed-test-format.test.ts` — extended with the `NOT_MEASURED_YET` describe block (TDD).
- `apps/web/src/lib/tools/speed-test/speed-test-format.ts` — added `export const NOT_MEASURED_YET = "Not measured yet.";` beside the `ABSENT` em dash.
- `apps/web/src/lib/tools/speed-test/quality-scores.svelte` — placeholder line now `{NOT_MEASURED_YET}` (was `"Scored once a run finishes."`).
- `apps/web/src/lib/tools/speed-test/server-panel.svelte` — `probe === null` branch now `{NOT_MEASURED_YET}` (was `"The round trip to Magna Carta has not been measured yet."`). The `unauthenticated`/`forbidden`/`unreachable` branches are byte-for-byte unchanged.
- `apps/web/src/lib/tools/speed-test/latency-chart.svelte`, `bandwidth-chart.svelte` — the SVG fallback `<text>` now consumes `{NOT_MEASURED_YET}` (was a literal `Not measured yet.`). The `aria-label`'s embedded `"...: not measured yet"` (lowercase, no period, part of a longer template string) is a different phrase from the literal constant and was left untouched per the task's explicit instruction.
- `apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte` — the packet-loss idle tile's `note` prop is now `{NOT_MEASURED_YET}` (was `"Measured when a test runs."`).

### TDD sequence

1. Added `NOT_MEASURED_YET` import + describe block to `speed-test-format.test.ts`.
2. `vp test speed-test-format` → failed (`NOT_MEASURED_YET` not exported, 1/10 failing).
3. Added the export.
4. `vp test speed-test-format` → 10/10 passed.
5. Wired the constant into the four consumers, then re-ran the full check/test set.

### Step 5 grep output (verbatim)

```
$ grep -rn "Not measured yet\|Scored once a run finishes\|Measured when a test runs\|has not been measured yet" apps/web/src/lib/tools/speed-test "apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte"
apps/web/src/lib/tools/speed-test/speed-test-format.ts:12:export const NOT_MEASURED_YET = "Not measured yet.";
```

Single hit: the constant's own definition. No stragglers.

### Test/check results

- `pnpm --filter @magna-carta/web run check` → `0 ERRORS 0 WARNINGS`.
- `vp test speed-test-format run-progress bandwidth-stats chart-scale` → 4 files, 34 tests, all passed.
- `svelte-autofixer` → clean for `quality-scores.svelte`, `server-panel.svelte`, `latency-chart.svelte`, `bandwidth-chart.svelte`.

## Commands run (chronological, both tasks)

```
vp test run-progress                                                              # red
vp test run-progress                                                              # green (11/11)
vp test speed-test-format                                                         # red
vp test speed-test-format                                                         # green (10/10)
grep -rn "Not measured yet\|Scored once a run finishes\|Measured when a test runs\|has not been measured yet" ...
pnpm --filter @magna-carta/web run check                                          # 0/0 (run after each task's edits)
vp test run-progress bandwidth-stats speed-test-format chart-scale measurement-ladder turn-capability   # 44/44 (Task 16 gate)
vp test speed-test-format run-progress bandwidth-stats chart-scale               # 34/34 (Task 17 gate)
git add <task-16 files> && git commit ...
git add <task-17 files> && git commit ...
```

## Commit hashes

- Task 16: `ddaec6d`
- Task 17: `2a9d22b`

## Note on committing in order

Because both tasks touch `+page.svelte`, I made all edits for both tasks first, then temporarily reverted the two Task-17-only lines in `+page.svelte` (the `NOT_MEASURED_YET` import and the packet-loss `note` prop), staged and committed exactly the Task 16 file set, reapplied the two lines, re-ran the full gate, and committed exactly the Task 17 file set. `git status --short` was checked before each commit to confirm only the intended files were staged.
