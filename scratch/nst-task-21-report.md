# Task 21 report: an unmeasured value reads N/A

Branch: `slice-0-7b-app-shell` (worktree `C:/dev/magna-carta-worktrees/slice-0-7a-design-system`)
Commit: `1ebf3bf65108c8f16ec8c92a1e5f24d26637bb15` — `fix(tools): an unmeasured value reads N/A`

## Files changed

- `C:/dev/magna-carta-worktrees/slice-0-7a-design-system/apps/web/test/speed-test-format.test.ts`
  — assertions changed first (TDD): every `formatBandwidth(undefined)` / `formatMilliseconds(undefined)`
  / `formatRatio(undefined)` expectation moved from `""` to `"N/A"`; kept the `formatRatio(0) === "0%"`
  pin.
- `C:/dev/magna-carta-worktrees/slice-0-7a-design-system/apps/web/src/lib/tools/speed-test/speed-test-format.ts`
  — `ABSENT` changed from `""` to `"N/A"` and exported (it needed a consumer outside this module — see
  below); comment rewritten to describe the third state (em dash → blank → `N/A`).
- `C:/dev/magna-carta-worktrees/slice-0-7a-design-system/apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte`
  — imported `ABSENT`; `statRows`'s null branch now returns `ABSENT` for Median/95th/Peak/Samples and
  for the shared `transferred` row when `spent === 0`; the packet-loss tile's pre-TURN-check branch
  (`store.turn` still undefined) now passes `value={ABSENT}` instead of a literal `""`.
- `C:/dev/magna-carta-worktrees/slice-0-7a-design-system/apps/web/src/lib/tools/speed-test/quality-scores.svelte`
  — imported `ABSENT`; the placeholder rating (`&nbsp;`) now renders `{ABSENT}`; the `NOT_MEASURED_YET`
  sentence line is untouched.
- `C:/dev/magna-carta-worktrees/slice-0-7a-design-system/apps/web/src/lib/tools/speed-test/metric-tile.svelte`
  — removed the dead nbsp-guard branches (see below).

## Why `+page.svelte`'s packet-loss line needed a fix beyond the plan's literal file note

The plan's Step 4 only names the `statRows` null branch, `quality-scores.svelte`, and `metric-tile.svelte`
as touch points, but there was a fourth call site already inlining a bare `""` directly into a `MetricTile`
`value` prop, bypassing every formatter:

```svelte
<MetricTile label="Packet loss" value="" note={NOT_MEASURED_YET} />
```

This is the case where `store.turn` itself hasn't resolved yet — a genuine unmeasured-value slot, exactly
what the task is about. The task's own "must not regress" list says: "Keep the `ABSENT` constant. Do not
inline empty strings or `N/A` at call sites... the named constant is what stops someone reintroducing a
zero later." Leaving this line as a literal `""` would have both violated that rule and left one Packet
loss state still rendering blank (via the metric-tile nbsp fallback) after every other slot switched to
`N/A` — a direct regression of the owner's ask. I exported `ABSENT` from `speed-test-format.ts` and used
it here instead of a literal.

## nbsp branches: removed vs. kept

**Removed — dead code**, in `metric-tile.svelte`:

```svelte
<div class={[...]}>{value === "" ? " " : value}</div>
...
<div class="text-sm">{stat.value === "" ? " " : stat.value}</div>
```

`MetricTile` has exactly one consumer in the whole app (`+page.svelte`, confirmed by
`grep -rn "<MetricTile" apps/web/src` returning only that file). Every `value`/`stats[].value` it is
ever handed now comes from `formatBandwidth`/`formatMilliseconds`/`formatRatio` (never return `""`
anymore), `String(stats.samples)`, `formatBytes(spent)`, the literal `"Unavailable"`, or the `ABSENT`
constant (`"N/A"`) — none of which is ever `""`. The nbsp branch was therefore unreachable, so I removed
it rather than leave a dead non-breaking-space fallback that could never fire, per the task's explicit
instruction ("retire the now-dead empty-value branch if it can no longer be reached").

**Kept — still reachable, intentionally untouched**, in `run-progress-panel.svelte`: this component
renders a literal `&nbsp;` for its counter/size row when a run has not started. Per the task prompt's
own note, that is "a different mechanism (an intentionally empty row), not an absent measurement" and
was explicitly out of scope. I did not touch it and confirmed by grep that it is the only remaining
`&nbsp;` in the speed-test tool directory.

No other call site in the codebase can still pass `""` to `MetricTile` — `quality-scores.svelte` uses
a `<dd>` directly (not `MetricTile`), so its own nbsp was addressed separately by swapping it for
`{ABSENT}`.

## Grep output (Step 5) with justification per hit

Command:
```
grep -rn "N/A\|Not measured yet\|—" apps/web/src/lib/tools/speed-test "apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte"
```

Full output (61 lines) — every hit is one of two categories:

1. **An em dash inside prose** — a comment (`/* ... */` or `//`) or a paragraph of user-facing copy
   inside `<p>...</p>` explanatory text (e.g. the InfoPopover bodies in `+page.svelte` lines 211, 227,
   270, 277). None of these is a *rendered value slot* — they are sentences, which is exactly where an
   em dash (ordinary punctuation) is allowed. No em dash appears as a stand-in for an absent
   measurement value anywhere in the diff.
2. **`N/A` / `Not measured yet`** — confined to the following, all legitimate:
   - `speed-test-format.ts:3-4,7,14` — the constant definitions themselves
     (`export const ABSENT = "N/A"`, `export const NOT_MEASURED_YET = "Not measured yet."`) and the
     comment explaining their relationship. This is the one home for both constants.
   - `metric-tile.svelte:42-43` — a comment describing that callers now pass `ABSENT` ("N/A") rather
     than `""`; not a rendered literal.
   - `quality-scores.svelte:38` — a comment explaining the placeholder rating now shows N/A; the
     actual rendered value is `{ABSENT}` (the constant), not an inlined string, so it doesn't match
     the grep's `N/A` literal — the comment text does.

No hit places `N/A` where a sentence belongs, and no hit is a rendered em dash standing in for a value.
`NOT_MEASURED_YET` appears exactly once as a definition (`speed-test-format.ts:14`) and is consumed by
reference everywhere else (`quality-scores.svelte`, `bandwidth-chart.svelte`, `latency-chart.svelte`,
`server-panel.svelte`, `+page.svelte`) — never duplicated as a literal string.

Raw output is reproduced below for completeness:

```
apps/web/src/lib/tools/speed-test/bandwidth-chart.svelte:8:   * The frame — the `<svg>` and the `<details>` — renders in every state, at its final height, so
apps/web/src/lib/tools/speed-test/bandwidth-chart.svelte:24:  // placeholder text in — this has no bearing on the fixed pixel HEIGHT that keeps the page still.
apps/web/src/lib/tools/speed-test/bandwidth-stats.ts:4: * The engine reports bandwidth at the 90th percentile of its samples, not the mean — so a single
apps/web/src/lib/tools/speed-test/connection-probe.ts:3: * like every other route, so what this measures is a REAL authenticated API call — the latency the
apps/web/src/lib/tools/speed-test/connection-probe.ts:4: * application actually experiences — not synthetic network round-trip. The interface says so.
apps/web/src/lib/tools/speed-test/connection-probe.ts:31:/** `status: null` means the request never got an answer — a transport failure, not a refusal. */
apps/web/src/lib/tools/speed-test/latency-chart.svelte:3:   * One latency phase as a point series — a small multiple. The three phases (idle, during
apps/web/src/lib/tools/speed-test/latency-chart.svelte:7:   * The frame — the `<svg>` and the `<details>` — renders in every state, at its final height, so
apps/web/src/lib/tools/speed-test/latency-chart.svelte:20:  // placeholder text in — this has no bearing on the fixed pixel HEIGHT that keeps the page still.
apps/web/src/lib/tools/speed-test/measurement-ladder.ts:3: * from — and with its `packetLoss` step deliberately removed.
apps/web/src/lib/tools/speed-test/measurement-ladder.ts:6: * server is discontinued and we run none, so the step can only fail — and a failure there aborts
apps/web/src/lib/tools/speed-test/measurement-ladder.ts:32: * — see turn-capability.ts. The batch figures are the library's documented defaults.
apps/web/src/lib/tools/speed-test/metric-tile.svelte:3:   * One headline measurement. `note` states why a metric is absent — a stated reason, never a
apps/web/src/lib/tools/speed-test/metric-tile.svelte:6:   * packet loss) — the value itself never changes structure, only scale.
apps/web/src/lib/tools/speed-test/metric-tile.svelte:42:    <!-- Every caller now passes a formatted value or the ABSENT constant ("N/A") — never an empty
apps/web/src/lib/tools/speed-test/metric-tile.svelte:43:         string — so the line box always has content and never needs a non-breaking-space guard. -->
apps/web/src/lib/tools/speed-test/quality-scores.svelte:7:   * Always renders the same three-column grid, scored or not — reserving its height from the
apps/web/src/lib/tools/speed-test/quality-scores.svelte:38:        <!-- The rating is absent, not zero — N/A shows a field waiting for data; NOT_MEASURED_YET
apps/web/src/lib/tools/speed-test/run-progress-panel.svelte:8:   * longest label the engine can emit — rendered invisibly beneath it — so a phase change never
apps/web/src/lib/tools/speed-test/run-progress-panel.svelte:12:   * elements — an element that disappears takes its height with it, and the controls beside this
apps/web/src/lib/tools/speed-test/run-progress.ts:5: * one of its requests grows slow, so the data a run will transfer — and therefore how long it will
apps/web/src/lib/tools/speed-test/run-progress.ts:6: * take — depends on the connection being measured. A remaining-time or remaining-megabytes figure
apps/web/src/lib/tools/speed-test/run-progress.ts:57: * PerformanceResourceTiming, which is the true bytes-on-the-wire — but only for the RESPONSE, so it
apps/web/src/lib/tools/speed-test/server-panel.svelte:3:   * Who served the measurement, and who you are to them — the same four facts Cloudflare's own
apps/web/src/lib/tools/speed-test/speed-test-engine.svelte.ts:7: * when the TURN relay credentials behind it are actually obtainable (see turn-capability.ts) —
apps/web/src/lib/tools/speed-test/speed-test-engine.svelte.ts:33:// Structural view of the engine's Results — only what this page renders. Reconciled against
apps/web/src/lib/tools/speed-test/speed-test-engine.svelte.ts:52: * The engine hands back the SAME `Results` instance on every call — it mutates `raw` in place
apps/web/src/lib/tools/speed-test/speed-test-engine.svelte.ts:115:  // Whether the relay credentials packet loss needs could be had — decided BEFORE the engine is
apps/web/src/lib/tools/speed-test/speed-test-engine.svelte.ts:126:  // directly — only its published (snapshotted) results and phase matter to the template. The
apps/web/src/lib/tools/speed-test/speed-test-engine.svelte.ts:130:  // an existing instance — only by disposing it and building a fresh one (see restart()).
apps/web/src/lib/tools/speed-test/speed-test-engine.svelte.ts:146:  // Loaded once, at store creation — not on Start. Cloudflare's own page names the measurement
apps/web/src/lib/tools/speed-test/speed-test-engine.svelte.ts:152:  // capability is decided BEFORE the engine is built (in start()/restart()) — never inside here —
apps/web/src/lib/tools/speed-test/speed-test-engine.svelte.ts:238:   * goes with it — an abandoned measurement is not a measurement, and nothing here is persisted.
apps/web/src/lib/tools/speed-test/speed-test-engine.svelte.ts:254:  /** Leaving the page must stop the transfer — a background tab never keeps spending bandwidth. */
apps/web/src/lib/tools/speed-test/speed-test-format.ts:3: * the page gained a sentence for absence), then nothing (which read as broken). `N/A` shows a field
apps/web/src/lib/tools/speed-test/speed-test-format.ts:4: * waiting for data. Where a SENTENCE belongs, the page says "Not measured yet." instead — see
apps/web/src/lib/tools/speed-test/speed-test-format.ts:7:export const ABSENT = "N/A";
apps/web/src/lib/tools/speed-test/speed-test-format.ts:14:export const NOT_MEASURED_YET = "Not measured yet.";
apps/web/src/lib/tools/speed-test/speed-test-meta.ts:3: * a CORS-open endpoint that needs no session — which is why this panel fills in even when our own
apps/web/src/lib/tools/speed-test/steady-label.svelte:5:   * These buttons swap words as the run changes phase — Pause becomes Resume, Cancel becomes
apps/web/src/lib/tools/speed-test/steady-label.svelte:6:   * Restart — and a button sized to its current word resizes when the word changes, shoving
apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte:3:   * Network Speed Test — Cloudflare's own measurement engine, on their ladder, so the numbers stay
apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte:5:   * credentials behind it can actually be had (asked before the engine is built — see
apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte:56:  // finished run must still show its FINAL step and a full bar — not a cleared slate. Presentation
apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte:64:   * ever show is listed here so SteadyLabel can reserve the widest one's width in the real font —
apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte:128:  // Always returns five rows — empty before a run has data — so the tile occupies its final
apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte:211:          The headline figure is the 90th percentile of this run's samples, not an average — nine
apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte:227:          The headline figure is the 90th percentile of this run's samples, not an average — nine
apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte:270:        Each measurement earns points against published thresholds — for example, unloaded latency
apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte:277:        Packet loss is not measured here, and it feeds all three ratings — online gaming draws on
```

## `formatRatio(0)` confirmation

Pinned by test (`speed-test-format.test.ts`, `formatRatio` describe block and the "an absent
measurement" describe block): `expect(formatRatio(0)).toBe("0%")` passes; `formatRatio(undefined)`
returns `"N/A"`. Confirmed green in the full test run below.

## Commands run

```
$ vp test speed-test-format                     # before constant change: 5 failed, 8 passed (expected FAIL)
$ vp test speed-test-format                     # after constant change: 13 passed (all)
$ pnpm --filter @magna-carta/web run check
> svelte-check --tsconfig ./tsconfig.json
COMPLETED 5408 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS

$ vp test speed-test-format run-progress bandwidth-stats chart-scale measurement-ladder turn-capability
Test Files  6 passed (6)
     Tests  47 passed (47)

$ grep -rn "N/A\|Not measured yet\|—" apps/web/src/lib/tools/speed-test "apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte"
(61 lines — see above)
```

## Commit

`1ebf3bf65108c8f16ec8c92a1e5f24d26637bb15` — `fix(tools): an unmeasured value reads N/A`

Files in the commit: `apps/web/src/lib/tools/speed-test/metric-tile.svelte`,
`apps/web/src/lib/tools/speed-test/quality-scores.svelte`,
`apps/web/src/lib/tools/speed-test/speed-test-format.ts`,
`apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte`,
`apps/web/test/speed-test-format.test.ts`. No other files were touched or staged.

Did not start a dev server; no browser verification performed, per instructions.
