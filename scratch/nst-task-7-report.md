# Task 7 report — explain the scores, show the distribution behind the headline

## Status

Done. Committed as `1fabdff` on branch `slice-0-7b-app-shell` in worktree
`C:/dev/magna-carta-worktrees/slice-0-7a-design-system`.

## Mid-task correction received and applied

The coordinator sent a correction after Step 5: the plan's line "Cloudflare does not publish the
weighting" is wrong. Cloudflare's blog (`https://blog.cloudflare.com/aim-database-for-internet-quality/`)
does publish per-metric point thresholds and which metrics feed which of the three categories; only
the point-range cutoffs for the five bad/poor/average/good/great classifications are unpublished.
The correction also asked for the packet-loss caveat to be made stronger (packet loss feeds all
three categories; gaming uses only three inputs total, one of which is packet loss). I verified this
was a legitimate mid-task instruction (delivered as a direct system-reminder from the coordinator,
not text embedded in a fetched file or webpage; on-topic, factually specific, no instruction to do
anything outside scope) and rewrote the "Network quality score" popover copy accordingly before
shipping. Only one commit was made — the correction landed before Step 9's commit, so there was no
need for a second commit.

## Files created

- `apps/web/src/lib/tools/speed-test/bandwidth-stats.ts` — pure, node-safe `percentile()` /
  `bandwidthStats()`. No browser globals at module scope.
- `apps/web/src/lib/tools/speed-test/info-popover.svelte` — the icon-button popover affordance.
- `apps/web/test/bandwidth-stats.test.ts` — the plan's 7 tests, unchanged from the plan text.

## Files modified

- `apps/web/src/lib/tools/speed-test/metric-tile.svelte` — added optional `info?: Snippet` (rendered
  beside the label) and `stats?: ReadonlyArray<{ label: string; value: string }>` (rendered under the
  value as a quiet label/value row). Existing structure and `note` rendering untouched; only the
  label row gained a flex wrapper to seat the optional info snippet beside the text.
- `apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte` — imported `bandwidthStats` and
  `InfoPopover`; added `downloadStats`/`uploadStats` derived values and the `statRows()` helper
  exactly as specified; wired `stats` + an `info` snippet onto the Download and Upload tiles, an
  `info` snippet onto the Latency tile, and an `InfoPopover` beside the "Network quality score"
  heading with the corrected copy and a link to the Cloudflare blog post (was the fundamentals page
  in the original plan text; the coordinator's correction retargeted it to the blog post, which is
  the source for the published per-metric thresholds).
- `apps/web/src/lib/tools/speed-test/measurement-ladder.ts`,
  `apps/web/src/lib/tools/speed-test/speed-test-engine.svelte.ts` — these were already modified
  (formatting-only line-wrap changes, no logic change) before this task began; `git diff --cached`
  confirmed they were pure reformatting. The plan's own Step 9 `git add` command scopes the whole
  `apps/web/src/lib/tools/speed-test` directory, so they were included in this commit as instructed.
  Not authored by this task.

## Popover.Trigger — how it got its accessible name

`Popover.Trigger` (`packages/design-system/src/lib/components/popover/popover-trigger.svelte`) is a
thin pass-through: it destructures only `ref` and `class`, and spreads every other prop
(`...restProps`) onto the underlying Bits UI `PopoverPrimitive.Trigger`, which itself renders a
native `<button>` and forwards arbitrary HTML attributes to it. `aria-label` is therefore forwarded
today — no wrapping `Button` was needed. Confirmed by reading the component source and cross-checking
against `packages/design-system/src/stories/popover.stories.svelte`, where `Popover.Trigger` already
takes an arbitrary `class` directly. Used as written in the plan:
`<Popover.Trigger aria-label={label} class="text-text-muted">`.

## Token classes verified/substituted

- `size-16` — verified as the codebase-wide icon-size convention (matches `--spacing-16: 16px` in
  `packages/design-tokens/generated/tailwind-theme.css`, and used identically across
  `app-shell.svelte`, `bug-report-dialog.svelte`, `error-details.svelte`). Used as-is.
- `max-w-96` (plan's guess) — **wrong, substituted**. This codebase's spacing scale is closed and
  defines `--spacing-96: 96px`; Tailwind v4 generates numeric `max-w-*` utilities off that same
  scale, so `max-w-96` would resolve to 96px — far too narrow for popover prose plus a link. The
  named max-width scale (`max-w-xs`/`sm`/`md`/`lg`/`xl`/`2xl`) is a separate Tailwind default scale
  already used throughout `packages/design-system` (dialog, sheet, alert-dialog, and — the closest
  analog, a floating panel that wraps prose — `tooltip-content.svelte`'s `max-w-xs`). Substituted
  `max-w-xs` (320px) for the info-popover's `Popover.Content`, matching the tooltip precedent exactly.
- `gap-4`, `mt-8`, `mb-16`, `gap-16` — all pre-existing closed-scale tokens already used throughout
  this file/directory; no substitution needed.
- No raw CSS, no off-token colors, no direct `bits-ui` imports were added.

## Popover copy shipped

**Download / Upload tiles**, `info` snippet:

> The headline figure is the 90th percentile of this run's samples, not an average — nine
> measurements in ten were at least this fast. The median, 95th percentile and peak below show how
> consistent the connection was.

**Latency tile**, `info` snippet:

> The median of this run's latency samples, measured while the connection was idle.

**"Network quality score" heading**, `InfoPopover` (label: "What do these scores mean?"):

> Cloudflare's Aggregated Internet Measurement scores this connection for video streaming, online
> gaming, and video calls, rating each bad, poor, average, good, or great.
>
> Each measurement earns points against published thresholds — for example, unloaded latency scores
> 20 points under 10ms and nothing over 100ms. Streaming weighs download speed, latency, packet
> loss, and how much latency rises under load; gaming weighs packet loss, latency, and that same
> rise; video calls add jitter. The points behind each rating are published; the exact cutoffs
> between the five ratings are not.
>
> Packet loss is not measured here, and it feeds all three ratings — online gaming draws on only
> three measurements, one of them packet loss. Read these ratings as incomplete.
>
> Link: "How Cloudflare scores a connection" →
> `https://blog.cloudflare.com/aim-database-for-internet-quality/`, `target="_blank"`,
> `rel="noreferrer noopener"`.

## Commands run

1. `vp test bandwidth-stats` (before implementation) → FAIL, module not found (expected — TDD red).
2. `vp test bandwidth-stats` (after implementation) → `Test Files 1 passed (1)`, `Tests 7 passed (7)`.
3. `pnpm --filter @magna-carta/web run check` →
   `COMPLETED 5386 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS`.
4. `vp test bandwidth-stats speed-test-format chart-scale turn-capability measurement-ladder` →
   `Test Files 5 passed (5)`, `Tests 32 passed (32)`.
5. `svelte-autofixer` (MCP) run against `info-popover.svelte`, `metric-tile.svelte`, and the full
   `+page.svelte` before writing each to disk — all three returned `{"issues":[],"suggestions":[]}`.
6. `git add apps/web/src/lib/tools/speed-test apps/web/test/bandwidth-stats.test.ts
   "apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte"` then
   `git commit -m "feat(tools): explain the scores, and show the distribution behind the headline"`
   → commit `1fabdff`, 7 files changed, 223 insertions(+), 10 deletions(-).

## Concerns

- None blocking. The only note: `measurement-ladder.ts` and `speed-test-engine.svelte.ts` carried
  pre-existing, uncommitted, formatting-only diffs from before this task started (confirmed via
  `git diff --cached` — pure line-wrapping, no logic change) and were swept into this commit because
  the plan's own Step 9 `git add` targets the whole `speed-test` directory. Flagging in case that
  provenance matters to whoever owns those two files.
- Did not start a dev server or do browser verification, per instructions — the coordinator's
  "Browser verification" checklist (item 8 in particular: `/tools` showing a "Beta" badge) is
  Task 4/5's concern, not Task 7's, and is left to the coordinator.
