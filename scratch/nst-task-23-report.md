# Task 23 — control buttons same size

## Diff

```diff
diff --git a/apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte b/apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte
index fef5603..a268cd0 100644
--- a/apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte
+++ b/apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte
@@ -60,14 +60,14 @@
   );
 
   /*
-   * The control region is always: panel, primary slot, secondary slot. Every word either slot could
-   * ever show is listed here so SteadyLabel can reserve the widest one's width in the real font —
-   * see steady-label.svelte. "Download report" is not wired to anything yet (that button lands
-   * separately); it is listed so its width is already reserved and adding the real button later
-   * moves nothing.
+   * Every word either control button can show. BOTH buttons reserve the width of the widest of
+   * them, so the pair is symmetric and neither resizes when its word changes. Reserving each slot
+   * against only its own words would still leave them unequal — "Resume" is shorter than "Restart".
+   *
+   * "Download report" is deliberately absent: it is not a run control, it lives in the overflow
+   * menu, and reserving its width here would make both buttons far wider than they need to be.
    */
-  const PRIMARY_LABELS = ["Start", "Pause", "Resume", "Retest"] as const;
-  const SECONDARY_LABELS = ["Cancel", "Restart", "Download report"] as const;
+  const CONTROL_LABELS = ["Start", "Pause", "Resume", "Retest", "Cancel", "Restart"] as const;
 
   const primaryLabel = $derived(
     store.phase === "idle"
@@ -102,15 +102,7 @@
   // disabled button naming an action it will not perform.
   const secondaryVisible = $derived(store.phase === "running" || store.phase === "paused");
 
-  const secondaryLabel = $derived(
-    store.phase === "running"
-      ? "Cancel"
-      : store.phase === "paused"
-        ? "Restart"
-        : store.phase === "finished"
-          ? "Download report"
-          : "Cancel",
-  );
+  const secondaryLabel = $derived(store.phase === "paused" ? "Restart" : "Cancel");
 
   function secondaryAction(): void {
     switch (store.phase) {
@@ -175,7 +167,7 @@
       bytesUsed={store.bytesUsed}
     />
     <Button variant="primary" onclick={primaryAction}>
-      <SteadyLabel labels={PRIMARY_LABELS} current={primaryLabel} />
+      <SteadyLabel labels={CONTROL_LABELS} current={primaryLabel} />
     </Button>
 
     <Button
@@ -185,7 +177,7 @@
       aria-hidden={secondaryVisible ? undefined : "true"}
       onclick={secondaryAction}
     >
-      <SteadyLabel labels={SECONDARY_LABELS} current={secondaryLabel} />
+      <SteadyLabel labels={CONTROL_LABELS} current={secondaryLabel} />
     </Button>
   </Masthead.Actions>
 </Masthead.Root>
```

File: `apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte`

## What changed and why

- `PRIMARY_LABELS` and `SECONDARY_LABELS` are gone, replaced by one `CONTROL_LABELS` array
  (`Start`, `Pause`, `Resume`, `Retest`, `Cancel`, `Restart`) passed to **both** `SteadyLabel`
  instances (primary button and secondary button). `Download report` is not in the array at all.
- `secondaryLabel` now only ever evaluates to `"Restart"` (phase `paused`) or `"Cancel"`
  (every other phase, including `running`, which is the only other phase where the secondary
  button is visible). The `finished → "Download report"` branch is deleted — dead code once the
  button lands in the overflow menu, and it would have been an invalid `current` value against the
  new shared `CONTROL_LABELS` set anyway (the word is no longer in the reservation).
- `secondaryVisible` (`running` or `paused`) is untouched — the invisible/`tabindex={-1}`/
  `aria-hidden` treatment of the secondary button for idle/finished/failed phases is unchanged, and
  it is still a real (inert) button, never a `disabled` one.
- `SteadyLabel` itself (`apps/web/src/lib/tools/speed-test/steady-label.svelte`) was not touched.
  Its `labels: readonly string[]` prop type already accepts the new shared array.

No pixel value, `min-width`, or `width` was introduced anywhere.

## Confirmation: no phase asks the secondary slot for "Download report"

`secondaryLabel` is now a two-armed ternary (`store.phase === "paused" ? "Restart" : "Cancel"`) —
there is no branch, reachable or not, that can produce `"Download report"`. The string appears
nowhere else in the file (checked by reading the full 335-line file after the edit). The word is
absent from `CONTROL_LABELS`, so even if a future edit reintroduced it as a `current` value,
`SteadyLabel`'s invisible-copy loop (`{#each labels as label}`) would never render a matching
hidden copy for it — the only way it could show is by being added back to the shared array, which
would immediately widen both buttons symmetrically, keeping the property intact by construction.

## How "both buttons are the same width in every phase" was established without measuring pixels

Both `SteadyLabel` invocations now receive the literal same array reference, `CONTROL_LABELS`.
`SteadyLabel` puts one `aria-hidden` invisible `<span>` per word in `labels`, all stacked in the
same CSS grid cell (`col-start-1 row-start-1`), plus the visible current word on top — the browser
lays out every invisible word in the real font and the grid cell sizes to the widest one
(`steady-label.svelte`, unmodified). Since both call sites pass the identical label set, the two
grid cells are asked to reserve width against the identical set of candidate strings, so the
browser computes the identical box width for both, in any font, at any zoom, in any phase — no
character count was compared by hand, and no number was hardcoded. This is exactly the "self-
maintaining" property the plan calls for: adding a future word to `CONTROL_LABELS` widens both
buttons together automatically.

## Commands run

`pnpm --filter @magna-carta/web run check`
```
COMPLETED 5408 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS
```

`vp test run-progress speed-test-format bandwidth-stats chart-scale measurement-ladder turn-capability`
```
Test Files  6 passed (6)
     Tests  47 passed (47)
```

Svelte MCP `svelte-autofixer` on the full modified file (`desired_svelte_version: 5`): `{"issues":[],"suggestions":[]}`.

## Commit

`10a5547f6641d61ff1000698c96466abd8338efe` — "fix(tools): both control buttons reserve the same words, so both are the same size"

Only the one file from Task 23 (`+page.svelte`) was staged and committed; other unstaged changes
present in this worktree from concurrent work were left untouched.
