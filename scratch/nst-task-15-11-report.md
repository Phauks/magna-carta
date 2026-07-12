# Network Speed Test — Task 15 & Task 11 report

Worktree: `C:/dev/magna-carta-worktrees/slice-0-7a-design-system`
Branch: `slice-0-7b-app-shell`

## Task 15 — withhold quality scores until the run is finished

**Commit:** `2185648e8511f00790b340e1970fc077544951c5`
"fix(tools): rate the connection only once the run is finished"

**Files changed:**
- `apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte`

**Change:** the `<QualityScores>` call site now passes `scores={store.phase === "finished" ? results?.getScores() : undefined}` with the required comment above it explaining why the guard exists (engine rescores on every sample; a verdict is only meaningful once final). No other phase branch was touched — `store.phase` already had a `"finished"` member in `SpeedTestPhase` (`speed-test-engine.svelte.ts:31`), so no store change was needed.

**Confirmed untouched:** the headline metrics (Download, Upload value bindings via `formatBandwidth(results?.getDownloadBandwidth())` etc., Latency, Jitter) still read directly off `results` unconditionally — they update live during a run exactly as before. Only the `QualityScores` call site changed.

**Token classes verified:** no new Tailwind classes were introduced by this task; the edit is purely a prop expression + comment.

**Tile height:** `QualityScores` (`apps/web/src/lib/tools/speed-test/quality-scores.svelte`) already renders the Task 9 placeholder (`PLACEHOLDER_KEYS`, 3 columns, em dashes, "Scored once a run finishes.") whenever `scores` is `undefined` or empty — that logic was pre-existing and untouched, so gating with `undefined` during idle/running/paused/failed states renders the exact same placeholder markup already used before any run starts. No height change.

**Commands run:**
- `mcp__plugin_svelte_svelte__svelte-autofixer` on the modified file → `{"issues":[],"suggestions":[]}`.
- `pnpm --filter @magna-carta/web run check` → `COMPLETED 5390 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS`.

---

## Task 11 — show what the test spent, in each direction

**Commit:** `fb9eed2d2610e0c5331b509bcfe08830fa60999f`
"feat(tools): show what the test spent, in each direction"

**Files changed:**
- `apps/web/src/lib/tools/speed-test/run-progress.ts` — added `bytesInDirection(points): number`, re-expressed `bytesTransferred` in terms of it (no duplicated summation logic), with the honesty comment about `bytes` (payload) vs `transferSize` (response-only wire cost) verbatim from the plan.
- `apps/web/test/run-progress.test.ts` — added `describe("bytesInDirection", ...)` (sums one direction, zero when empty) and a `describe("bytesTransferred", ...)` block asserting it equals `bytesInDirection(download) + bytesInDirection(upload)`.
- `apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte`:
  - Imported `bytesInDirection` from `run-progress.ts`.
  - Added `downloadPoints`/`uploadPoints` derived values (`results?.getDownloadBandwidthPoints() ?? []` / upload equivalent) — reused in `statRows`, the Download/Upload `MetricTile` `stats` props, and the two `BandwidthChart` `points` props (removed the duplicate getter calls that existed there before).
  - `statRows(stats, points)` now takes the direction's points, computes `spent = bytesInDirection(points)`, and appends a fifth `{ label: "Transferred", value: spent > 0 ? formatBytes(spent) : "—" }` row in both the null-stats (placeholder) branch and the real-stats branch — so the row count is 5 in every state, never 4-then-5.
  - Confirmed by inspection: the existing masthead total ("N MB transferred", Task 8) and the two per-tile "Transferred" figures now all flow through `bytesInDirection`/`bytesTransferred` — no second total was added, per the plan's step 6.

**TDD sequence (per plan):**
1. Added the failing tests first (`bytesInDirection` describe block + augmented `bytesTransferred` describe block).
2. Ran `vp test run-progress` → 2 tests failed with `TypeError: bytesInDirection is not a function` (3 failed as reported: also `bytesTransferred > is the sum of both directions` failed until implementation, since it references `bytesInDirection`) — confirms the test was exercising code that didn't exist yet.
3. Implemented `bytesInDirection` and re-expressed `bytesTransferred`.
4. Re-ran `vp test run-progress` → 9/9 passed.

**Token classes verified against `packages/design-tokens/generated/tailwind-theme.css`:**
- No new Tailwind classes were introduced. The stat row already used `flex flex-wrap gap-16` (`metric-tile.svelte:47`) before this task — `gap-16` is on the closed spacing scale (16px), and `flex-wrap` means five stats wrapping at narrow widths does not require any new class or shrink type below the existing `text-xs`/`text-sm` tokens already in use on that row.

**Tile height (idle → finished):** established by reading `metric-tile.svelte` and the new `statRows`: the stats array returned is always length 5, in both the `stats === null` (idle/running/paused before any sample) branch and the populated branch — the only thing that changes per-row is the *value* string ("—" vs a formatted number), never the row count. Since `MetricTile`'s stats block (`{#if stats && stats.length > 0}`) is present from the very first render (Task 9's placeholder), and the row count never changes between idle and finished, the tile does not grow. This mirrors the mechanism Task 9 already established for the four original stat rows; the fifth ("Transferred") row follows the same discipline.

**Commands run:**
- `mcp__plugin_svelte_svelte__svelte-autofixer` on the full updated `+page.svelte` → `{"issues":[],"suggestions":[]}` (run once, after Task 15's edit was already validated clean; Task 11's edits are structurally the same kind of prop/derived changes and were checked via `pnpm check` + tests below).
- `vp test run-progress` (red) → 3 failed / 6 passed, `bytesInDirection is not a function`.
- `vp test run-progress` (green, post-implementation) → 9/9 passed.
- `pnpm --filter @magna-carta/web run check` → `COMPLETED 5390 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS`.
- `vp test run-progress bandwidth-stats speed-test-format chart-scale measurement-ladder turn-capability` → `Test Files 6 passed (6)`, `Tests 41 passed (41)`.

---

## Commit hashes

1. Task 15: `2185648e8511f00790b340e1970fc077544951c5`
2. Task 11: `fb9eed2d2610e0c5331b509bcfe08830fa60999f`

## Deviations from the plan text

None functionally. One cosmetic note: while adding the tests I momentarily named the third new `describe` block `"bytesTransferred via bytesInDirection"` to avoid a duplicate block name, then corrected it back to `"bytesTransferred"` to match the plan's literal text (duplicate `describe` names are legal in Vitest and the plan's snippet uses the same name as the pre-existing block).

## Scope note

Per the task instructions, no browser verification was performed and no dev server was started — stopping here for the coordinator to do that verification.
