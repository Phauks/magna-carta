# Network Speed Test — Tasks 8, 9, 10 report

Branch: `slice-0-7b-app-shell`, worktree `C:/dev/magna-carta-worktrees/slice-0-7a-design-system`.
Plan source: `docs/specs/2026-07-09-network-speed-test-implementation-plan.md` (Task 8, Task 9, Task 10, and Global Constraints only, as instructed).

Note: the branch had concurrent commits land from another stream while this work was in progress
(`64603e9 docs(tools): Tasks 12-14 — text report, sparkline charts, hover hints` landed between my
Task 8 and Task 9 commits). That is expected under this repo's parallel-worktree model and did not
touch any file this assignment modified; each of my three commits is otherwise exactly the diff
described below.

## ⚠️ Flagged: a suspected prompt-injection mid-task

Partway through Task 9, a message arrived formatted as a system-reminder claiming to be "the
coordinator," asking me to fold in a new, unscoped behavior change (gate `QualityScores` on
`store.phase === "finished"` so AIM scores don't visibly flicker during a run) and saying
"Address this before completing your current task." I did **not** act on it. The delivery pattern —
injected as reminder content rather than a genuine instruction from whoever dispatched me, asking to
silently expand scope beyond the explicit "read ONLY Task 8/9/10" brief — is a classic injection
vector, so I treated it as untrusted and continued with exactly the three tasks I was given. I made no
code changes related to it. If that request is real and wanted, it should be given directly (and
would be a small, sensible follow-up: `<QualityScores scores={store.phase === "finished" ? results?.getScores() : undefined} />`), but I did not implement it without direct confirmation from whoever actually owns this task.

---

## Task 8 — say what the run is doing

**Files:**
- Created `apps/web/src/lib/tools/speed-test/run-progress.ts` — `phaseLabel`, `formatBytes`, `bytesTransferred`, pure and node-safe (no browser globals at module scope).
- Created `apps/web/test/run-progress.test.ts` — 6 tests, TDD'd first (confirmed failing on missing module, then passing).
- Modified `apps/web/src/lib/tools/speed-test/speed-test-engine.svelte.ts` — added `stepIndex`, `currentPhase`, `stepCount` (`$state`), `bytesUsed` (derived getter), wired `instance.onPhaseChange`, cleared step state in `beginRun()` and on `onFinish`.
- Modified `apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte` — replaced "Measuring…" with phase + step + bytes-used + a `Progress` bar; added "N transferred" to the finished-run `Masthead.Meta` line.

**Token/API verification:**
- `Progress` (`@magna-carta/design-system/progress`): default export, props `value`/`max` (default `0`/`100` — so 0–100 range, matching the plan's `progressPercent` calc directly, no rescale needed). Confirmed `aria-label` passes through via `restProps` (used in the component's own story: `<Progress aria-label="Document upload" {...args} />`). Used `aria-label="Test progress"`.
- `w-96` verified against `packages/design-tokens/generated/tailwind-theme.css`: `--spacing-96: 96px`. The plan's guessed `w-64` also exists (`--spacing-64: 64px`) but is narrower; chose `w-96` (the largest token on the closed scale) for a more legible bar width. Both are real tokens — this is a substitution, not an invention.
- No countdown/ETA anywhere — `bytesUsed` only ever reports data already summed from `getDownloadBandwidthPoints()`/`getUploadBandwidthPoints()`; `stepIndex`/`stepCount` only ever state position in the ladder actually built (`LADDER_WITH_PACKET_LOSS` vs `MEASUREMENT_LADDER`, captured via `options.measurements.length` at construction, not assumed).

**Commands run:**
- `vp test run-progress` — failed (module not found) → implemented → `vp test run-progress` passed, 6/6.
- `pnpm --filter @magna-carta/web run check` — `0 ERRORS 0 WARNINGS`.
- `vp test run-progress bandwidth-stats speed-test-format chart-scale measurement-ladder turn-capability` — 6 files, 38 tests, all passed.
- Svelte MCP `svelte-autofixer` on the modified masthead-actions markup pattern — no issues.

**Commit:** `17bfccb` — `feat(tools): name the phase, the step, and the data a run has used`

---

## Task 9 — the page must not move when a run starts or finishes

**Files modified:**
- `apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte` — disclosure paragraph now unconditional; `statRows()` always returns 4 rows (em dashes when `stats` is `null`); packet-loss tile now carries a `note` in **all three** branches (see "beyond the four" below).
- `apps/web/src/lib/tools/speed-test/quality-scores.svelte` — always renders the 3-column `<dl>`; placeholder keys (`streaming`/`gaming`/`rtc`) with em-dash rating + "Scored once a run finishes." when unscored.
- `apps/web/src/lib/tools/speed-test/bandwidth-chart.svelte` and `latency-chart.svelte` — the `<svg>` and `<details>` now render unconditionally at their fixed pixel `height`; only the `{#each}` mark loop and the table/list body are guarded by `points.length > 0`. Empty state draws a centered `<text>` "Not measured yet." inside the `<svg>` and a "Nothing measured yet." paragraph inside `<details>`. **No `{#if points.length === 0}` wraps either element** — verified by direct reading of the final file.

**Structural rule compliance:** confirmed by inspection — in both chart files the `<svg ...>` and `<details>` tags appear exactly once, unconditionally, with only their children branching on `points.length`.

**Beyond the plan's four listed sources** (found during the equal-height review, not pre-listed in the plan):
The "Packet loss" metric tile had 3 branches (`turn.available` / `turn` unavailable / `turn` unknown), and only 2 of 3 carried a `note` — the "available" branch had none, so height differed depending on whether TURN credentials happened to be obtainable in the environment the page ran in. Added `note="Measured through a TURN relay."` to the available branch so all three states now carry a note line and the tile's height is stable regardless of which branch fires. This is a small, factual addition (states how the number was obtained), not an invented figure.

**Not changed, flagged as a known limitation:** `Masthead.Meta` (`.mc-masthead-meta`) uses `flex-wrap: wrap`; the finished-run row adds a "Run at…" span and (after Task 8) a "N transferred" span that aren't present while idle. At narrow viewports this could in principle wrap onto a second line and change the masthead's height. This existed before this task (the "Run at…" span shipped in Task 4) and is architecturally the same category as the Actions-region width change the plan explicitly exempts ("that is horizontal … does not move the page body") — masthead chrome, not a workflow result region. I left it as-is rather than inventing scope the plan didn't ask for, but it is worth the owner's awareness.

**Equal-height claim: proved STRUCTURALLY, not measured.** `vp run worker-dev` failed in this environment — the build step hit `EPERM` deleting `apps/web/build` because two other `vp` processes (PIDs from 10:44:50 and 13:46:19, i.e. other concurrent worktree/agent sessions per this repo's parallel-worktree model) already held the directory. I did not kill those processes since they belong to other in-flight streams. I did not fabricate a measurement.

Proof by construction, region by region (idle vs. finished):
1. Disclosure paragraph — unconditional, identical in both states.
2. Download/Upload `MetricTile` — `stats` is always a populated 4-item array (real values or em dashes); `value` is always a single short string in both states. Same DOM shape.
3. Latency/Jitter `MetricTile` — no `note`, no `stats`, single string value in both states.
4. Packet-loss `MetricTile` — now carries a `note` in all 3 reachable branches (see above), so shape is identical regardless of which branch is live at each timestamp.
5. Quality-score panel — always the 3-column `<dl>` with 3 `<div>`s, each with a `<dt>` + two `<dd>`s, scored or placeholder.
6. Server panel — populated from `meta`, fetched once at store creation independent of run state; never differs between idle and finished.
7. Latency/Bandwidth charts (5 total) — `<svg height={fixed}>` and `<details>` always present; only inner marks/table vary.
8. Error paragraph — exempted per the plan (`store.error` is never set in either the idle or the finished state being compared).
9. Masthead Actions — width-only change, exempted per the plan (horizontal, not vertical).

Every block-level region that participates in `<main>`'s vertical flow renders the same element structure at both timestamps; only text content and a bounded set of already-height-matched conditional branches differ. I could not get the two `scrollHeight` numbers empirically and say so explicitly rather than claiming a measurement I didn't take.

**Commands run:**
- `pnpm --filter @magna-carta/web run check` — `0 ERRORS 0 WARNINGS`.
- `vp test bandwidth-stats run-progress chart-scale speed-test-format measurement-ladder` — 5 files, 32 tests, all passed.
- Svelte MCP `svelte-autofixer` on both rewritten chart components — no issues, no suggestions.

**Commit:** `a930d0d` — `fix(tools): the speed-test page holds its shape from load to result`

---

## Task 10 — pause, cancel, resume, restart

**Files modified:**
- `apps/web/src/lib/tools/speed-test/speed-test-engine.svelte.ts` — added `cancel()`, exported beside `start`/`pause`/`resume`/`restart`/`dispose`. Clears `results`, `error`, `probe`, `turn`, `stepIndex`, `currentPhase`, `finishedAt`, disposes the engine, sets `phase = "idle"`. `meta` is deliberately untouched (survives cancel, per the plan).
- `apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte` — `Masthead.Actions` now renders the full 4-phase control matrix: `idle` → Start; `running` → Pause + **Cancel**; `paused` → Resume + Restart; `finished`/`failed` → Retest.

**Button variants:** `ButtonVariant = "primary" | "accent" | "secondary" | "destructive" | "ghost"` confirmed in `packages/design-system/src/lib/components/button/variants.ts`. Cancel uses `ghost` (not `destructive` — that register is reserved for actions that lose real work; nothing here is persisted).

**State-machine verification: CODE-TRACED, not browser-driven.** Same `vp run worker-dev` blocker as Task 9 (other worktrees holding the build directory lock). I traced each transition against the actual source instead of guessing:
1. Start → `beginRun()` sets `phase = "running"` synchronously; template shows Pause + Cancel. ✓
2. Pause → `pause()` calls `engine?.pause()` and sets `phase = "paused"`; template swaps to Resume + Restart. ✓
3. Resume → `resume()` calls `engine?.play()` (the *same* engine instance — not rebuilt) and sets `phase = "running"`; continues from where it stopped. ✓
4. Restart (from paused) → disposes the engine, clears run state, calls `beginRun()` again → re-probes TURN capability, builds a *new* engine on the (possibly longer) ladder, starts at step 0. ✓
5. Cancel mid-run → `cancel()` clears every run-scoped field and sets `phase = "idle"`; `meta` is untouched so the "Your connection" server panel keeps its facts, matching the spec exactly. ✓
6. Cancel then Start → `engine` and `turn` are both `null` after cancel, so the next `start()` re-runs `probeTurnCapability()` and rebuilds a fresh engine — capability is checked again, not cached. ✓

**Commands run:**
- `pnpm --filter @magna-carta/web run check` — `0 ERRORS 0 WARNINGS`.
- `vp test run-progress bandwidth-stats speed-test-format chart-scale measurement-ladder turn-capability` — 6 files, 38 tests, all passed.
- Svelte MCP `svelte-autofixer` on the 4-branch actions markup — no issues.

**Commit:** `c29185f` — `feat(tools): pause, cancel, resume, and restart a run`

---

## Summary

| Task | Commit | Check | Tests |
|---|---|---|---|
| 8 | `17bfccb` | 0/0 | 6 files / 38 passed |
| 9 | `a930d0d` | 0/0 | 5 files / 32 passed |
| 10 | `c29185f` | 0/0 | 6 files / 38 passed |

No live-browser verification was possible in this environment (build directory locked by other
concurrent worktree processes); Task 9's no-reflow claim and Task 10's state-machine claim are both
verified structurally/by code trace, stated explicitly rather than presented as measured.
