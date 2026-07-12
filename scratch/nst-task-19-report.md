# Task 19 — The control area is the same size in every phase

Implemented the version of Task 19 at line 4370 of
`docs/specs/2026-07-09-network-speed-test-implementation-plan.md` (the later, superseding
occurrence — 7 steps, covers all four owner complaints including the finished-phase collapse and
the masthead double-count of bytes transferred). The earlier occurrence at line 4148 (6 steps, no
Step 4/masthead cleanup) was NOT the one implemented, since the task instructions I was given match
the later one verbatim (four symptoms, `idle → running → paused → finished → failed`, "Download
report" footnote, Step 4 masthead cleanup, commit message `fix(tools): the control area is the same
size in every phase`).

## Files changed

- Created: `apps/web/src/lib/tools/speed-test/steady-label.svelte`
- Modified: `apps/web/src/lib/tools/speed-test/run-progress-panel.svelte`
- Modified: `apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte`

## What changed

**`steady-label.svelte` (new).** Stacks every candidate word for a slot invisibly in the same grid
cell (`col-start-1 row-start-1`), with the current word rendered on top in the same cell. The
browser measures the widest candidate in the real font; the visible word never changes that
measurement. Copied verbatim from the plan's Step 1 snippet.

**`run-progress-panel.svelte`.** The counter row (`Step N of M` / `X used`) used `""` as its
"nothing yet" placeholder, which has no content and therefore no height — the row collapsed before
a run started or after `bytesUsed` reset. Replaced both `""` placeholders with the same
non-breaking space (U+00A0) character the panel's own comment and `metric-tile.svelte` already
established as the convention for "line box present, nothing to say." Verified by byte-inspection
(see below) that both edits produced the exact `0xC2 0xA0` UTF-8 sequence, not a plain `0x20` space,
which would have collapsed away as the element's only content.

**`+page.svelte`.**
- Added `PRIMARY_LABELS = ["Start", "Pause", "Resume", "Retest"]` and
  `SECONDARY_LABELS = ["Cancel", "Restart", "Download report"]`.
- Derived `primaryLabel` / `primaryAction` and `secondaryLabel` / `secondaryAction` /
  `secondaryVisible` from `store.phase`, replacing the four-way `{#if store.phase === …}` block that
  used to mount and unmount different `<Button>` elements per phase.
- The control region now always renders exactly two `<Button>` elements (never conditionally
  mounted/unmounted): primary (`variant="primary"`, always visible) and secondary
  (`variant={paused ? "secondary" : "ghost"}`, wrapped in `SteadyLabel`). The secondary button is
  visible only in `running` (Cancel) and `paused` (Restart); in `idle`, `finished`, and `failed` it
  renders with `class="invisible"`, `tabindex={-1}`, and `aria-hidden="true"` — box reserved, but out
  of the tab order and never announced. Per the plan's footnote, `"Download report"` is listed in
  `SECONDARY_LABELS` purely to reserve its width now (that button is a separate, not-yet-built
  feature); it is never the visible label with `secondaryVisible === true`, so no button today claims
  an action it doesn't perform.
- Cancel stays `variant="ghost"` (never `destructive`); Restart stays `variant="secondary"` — no new
  variant introduced, matching Task 20's already-landed ghost-ring change.
- Step 4: deleted the masthead's `{formatBytes(store.bytesUsed)} transferred` line (and the now
  needless `Masthead.MetaSeparator`) since the progress panel already prints the same figure as
  `… used`. `Masthead.Meta` still renders unconditionally — either the "Run at …" line or "Not run
  yet" — in every phase, so it never collapses.

## Token classes verified

Checked every Tailwind class touched against
`packages/design-tokens/generated/tailwind-theme.css` (spacing scale: `--spacing-0` through
`--spacing-96`, i.e. 0/4/8/12/16/20/24/32/40/48/64/96 in px):

- No new spacing/pixel utility class was introduced anywhere in this task. `steady-label.svelte`
  uses only `grid`, `invisible`, `col-start-1`, `row-start-1`, `whitespace-nowrap` — structural
  Tailwind utilities with no numeric/pixel dimension, already used identically in
  `run-progress-panel.svelte`'s pre-existing (shipped, Task 18) phase-label reservation.
- `+page.svelte`'s edits reuse only classes already present in the file (`mb-24`, `gap-*` via the
  design system's `mc-masthead-actions` recipe) — no new class added to the markup besides the two
  `<Button>`/`<SteadyLabel>` pairs, which carry no spacing classes of their own.
- `run-progress-panel.svelte` was not touched beyond the two placeholder-string edits; no class
  changed.

## How I established the control region does not resize (idle → running → paused → finished → failed)

Browser verification was explicitly out of scope for this task (the coordinator runs it), so this
was established by static/structural inspection, not by measuring pixels — per the plan's own
warning ("if you find yourself computing a pixel value, you have taken the wrong path"):

1. **No conditional mount/unmount in the control region.** The old code had
   `{#if idle}<Button>Start</Button>{:else if running}<Button>Pause</Button><Button>Cancel</Button>…{/else}`
   — a different number of `<Button>` elements per phase, which is exactly "an element with no
   content has no size" (zero elements at idle beyond Start). The new code renders exactly the same
   two `<Button>` elements, unconditionally, in every phase; only the text inside each
   `SteadyLabel` and each button's `variant`/`class`/`tabindex`/`aria-hidden` attributes change.
   Same element, same position in the tree, in all five phases.

2. **Primary button geometry is phase-invariant.** `variant="primary"` never changes across phases,
   and `size` is never passed (defaults to `"default"` in every phase alike), so
   `.mc-button` + `.mc-button-primary` + `.mc-button-md` apply identically in idle/running/
   paused/finished/failed — same `min-block-size`, `padding-inline`, `font-size`. Its width is
   `SteadyLabel`'s grid width, which is the intrinsic width of the widest of
   `Start`/`Pause`/`Resume`/`Retest` measured in the same font/weight/size in every phase (the
   invisible copies are rendered unconditionally, in the same cell, regardless of which word is
   currently visible on top) — so the width is the same number in all five phases, not recomputed
   per phase.

3. **Secondary button geometry is phase-invariant.** `.mc-button-ghost` and `.mc-button-secondary`
   differ only in `background-color`/`box-shadow` (color), not in any sizing property — both share
   the base `.mc-button` + `.mc-button-md` box model. `visibility: hidden` (Tailwind `invisible`)
   keeps the element in normal flow with its computed box intact; it does not collapse the box the
   way `display: none` or an absent element would. Its `SteadyLabel` reserves the width of the
   widest of `Cancel`/`Restart`/`Download report` unconditionally, so the same width applies whether
   the button is currently showing "Cancel", "Restart", or nothing (invisible).

4. **The panel's three rows never lose their line box.** Row 1 (counter/size) previously rendered
   `""` when idle — no text node content, collapsed line box, which is why the panel grew the
   moment a run produced its first value. It now renders U+00A0 in that branch in every phase,
   confirmed by byte-level inspection (`grep | od -c` showed `0xC2 0xA0` on both edited lines,
   matching `metric-tile.svelte`'s existing convention exactly). Row 2 (phase descriptor) already
   used the Task 18 invisible-widest-label reservation, unchanged. Row 3 (`Progress`) is the same
   component instance in every phase; its height is fixed by the component's own recipe regardless
   of `value`.

5. **The masthead meta never collapses.** `Masthead.Meta`'s `{#if store.finishedAt}…{:else}…{/if}`
   always renders exactly one `<span>` in either branch — never an empty meta — so the masthead's
   own height is phase-invariant too. Deleting the `bytesUsed > 0` sub-line (and its
   `Masthead.MetaSeparator`) removes the one case that used to make the meta 1 line before a run
   finished and 2 lines after it if `bytesUsed > 0`; it is now unconditionally 1 line in both
   branches.

No pixel value was computed or hardcoded anywhere in this change; the invisible-copy grid technique
is the only sizing mechanism, per the plan's explicit instruction.

## Accessibility

- Every invisible candidate label in `SteadyLabel` carries `aria-hidden="true"` — confirmed present
  on the `{#each}`-rendered span in `steady-label.svelte`; only the current, visible label (last
  `<span>`, no `aria-hidden`) is available to assistive tech, so a screen reader hears one word, not
  four (or three, for the secondary slot).
- The secondary `<Button>` at idle/finished/failed carries `tabindex={-1}` and `aria-hidden="true"`
  in addition to `class="invisible"` — removed from the tab order and hidden from assistive tech, per
  the plan's explicit instruction not to render a disabled button naming an action it will not
  perform. No `disabled` attribute is used for this purpose anywhere.

## Commands run

```
pnpm --filter @magna-carta/web run check
```
Output: `COMPLETED 5408 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS`

```
vp test run-progress speed-test-format bandwidth-stats chart-scale measurement-ladder turn-capability
```
Output: `Test Files  6 passed (6)` / `Tests  47 passed (47)`

Also ran, ad hoc, to confirm the NBSP byte encoding in `run-progress-panel.svelte` matched the
existing `metric-tile.svelte` convention exactly:
```
grep -n 'stepIndex !== null' apps/web/src/lib/tools/speed-test/run-progress-panel.svelte | od -c
grep -n 'bytesUsed > 0' apps/web/src/lib/tools/speed-test/run-progress-panel.svelte | od -c
```
Both showed `" 302 240 "` (octal) = `0xC2 0xA0` = U+00A0, matching
`apps/web/src/lib/tools/speed-test/metric-tile.svelte`'s pre-existing `value === "" ? " " : value}`
placeholder byte-for-byte.

Both `.svelte` files were also validated with the Svelte MCP `svelte-autofixer` tool
(`desired_svelte_version: 5`): zero issues, zero suggestions for both `steady-label.svelte` and
`run-progress-panel.svelte`. `+page.svelte` imports via the `$lib` alias and SvelteKit route
conventions the standalone autofixer cannot resolve, so it was instead validated end-to-end via
`svelte-check` (`pnpm --filter @magna-carta/web run check`), which covers the same rune/markup
correctness for a real route file and returned 0 errors / 0 warnings.

## Not in scope (left untouched)

- Task 12's actual "Download report" button/feature — not built here; only its label width is
  reserved per the plan's footnote.
- Task 21 (`N/A` for unmeasured values) — separate task, separate files/commit; `speed-test-format.ts`
  was not touched.
- Task 20 (ghost button ring) — already landed on this branch (`deb3bf7`) prior to this session;
  confirmed present in `packages/design-system/src/lib/components/button/button.css` and relied on
  as-is (Cancel's `ghost` variant now reads as a control without any change from this task).

## Commit

`fix(tools): the control area is the same size in every phase` — see hash in the final summary
message.
