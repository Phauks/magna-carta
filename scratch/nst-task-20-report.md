# Task 20 report — ghost button gains an edge at rest

## Exact CSS added

`packages/design-system/src/lib/components/button/button.css`, replacing the `.mc-button-ghost` block:

```css
  /*
   * Ghost — a quiet action that still reads as a control. It carried no edge at rest, which left
   * the affordance invisible until the pointer found it; a control the eye cannot find is not
   * quiet, it is hidden.
   *
   * The edge is an INSET RING, not a border: the base recipe has no border, and sizes map to
   * min-block-size plus padding, so a real border would make every ghost button two pixels taller
   * than the buttons beside it. A ring costs no layout.
   *
   * --mc-border-default, not --mc-border-strong: every other resting-state bordered control
   * (input, select, card, dialog, tabs, data-table) draws its rest-state edge in
   * --mc-border-default; --mc-border-strong is reserved for emphasis states (a checked checkbox,
   * a checked switch, a selected date range). Ghost's ring is a resting-state edge, not an
   * emphasis state, so the quieter weight is the one that matches its neighbors.
   */
  .mc-button-ghost {
    background-color: transparent;
    color: var(--mc-text-default);
    box-shadow: inset var(--mc-space-0) var(--mc-space-0) var(--mc-space-0)
      var(--mc-border-width-default) var(--mc-border-default);
  }
  .mc-button-ghost:hover {
    background-color: var(--mc-action-secondary);
  }
  /* The disabled recipe (.mc-button:disabled, above) sets an opaque fill; the ring beneath would
     otherwise show as a seam around a control that no longer takes input. */
  .mc-button-ghost:disabled {
    box-shadow: none;
  }
```

`variants.ts` was not touched — no new variant.

## Border token chosen: `--mc-border-default` (not `--mc-border-strong`)

The plan's illustrative snippet used `--mc-border-strong`, but the plan explicitly asked me to
choose and justify. I picked `--mc-border-default` because it is the token every other
*resting-state* bordered control in the system already uses: input, select, card, dialog, tabs,
data-table all draw their normal, unemphasized edge in `--mc-border-default`. `--mc-border-strong`
shows up only at emphasis states — a checked checkbox, a checked switch, a selected date-range
edge, a scrollbar thumb. Ghost's ring is a plain resting-state affordance, not an emphasis state,
so using `--mc-border-strong` would make a "quiet" button's edge louder than an ordinary text
input's border — the opposite of quiet. `--mc-border-default` matches ghost's edge weight to its
neighbors.

## `:disabled` behavior

`.mc-button:disabled` (base recipe) already sets an opaque `background-color` and muted
foreground for every variant. Without an override, the ghost ring would still paint as an inset
line around that opaque fill — a seam on a control that no longer accepts input. Added
`.mc-button-ghost:disabled { box-shadow: none; }` so the ring disappears the moment the button is
disabled; only the standard disabled fill/foreground show, consistent with every other disabled
button variant.

## Grep output — one line per call site

```
apps/web/src/lib/components/bug-report-dialog.svelte:115
apps/web/src/lib/components/bug-report-dialog.svelte:165
apps/web/src/lib/developer/modules/motion/motion-module.svelte:340
apps/web/src/lib/developer/modules/motion/motion-module.svelte:341
apps/web/src/lib/settings/components/request-change-dialog.svelte:221
apps/web/src/lib/settings/components/settings-commit-footer.svelte:78
apps/web/src/lib/settings/components/settings-ledger.svelte:149
apps/web/src/lib/settings/components/settings-row.svelte:226
apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte:117
packages/design-system/src/lib/components/data-table/data-table-column-filter.svelte:181
packages/design-system/src/lib/components/data-table/data-table-column-filter.svelte:168 (conditional ghost/secondary)
packages/design-system/src/stories/card.stories.svelte:34
```

(11 distinct `variant="ghost"` occurrences plus one conditional ternary at line 168 that renders
`ghost` for inactive presets — 12 lines total, matching the plan's "eleven existing call sites"
plus the conditional it didn't enumerate separately.)

1. **bug-report-dialog.svelte:115** — "Included diagnostics" disclosure toggle (chevron + label),
   standalone, `self-start` — now shows as a small boxed pill sitting alone above the diagnostics
   `<pre>` block. Reads fine as a disclosure control.
2. **bug-report-dialog.svelte:165** — "Close" in the dialog footer, beside a disabled `secondary`
   "Submit" button — now shows a thin ring, visually pairs sensibly as the quieter of the two
   footer actions.
3. **motion-module.svelte:340** — "Reset curve", one of two ghost buttons in a `gap-4` row beside
   a primary "Copy motion report" button.
4. **motion-module.svelte:341** — "Reset all", immediately next to "Reset curve" with only 4px
   gap — **flag**: two adjacent ringed boxes with a very tight gap will read as a single
   two-compartment segmented control rather than two independent buttons; worth the owner's eye.
5. **request-change-dialog.svelte:221** — "Close" in a dialog footer beside disabled
   `secondary`/`primary` buttons — same shape as #2, reads fine.
6. **settings-commit-footer.svelte:78** — one ghost button per staged-change entry, rendered in a
   vertical list inside a `Popover.Content`, `justify-start`, `size="sm"` — **flag**: this is a
   popover menu-like list of rows; each row now gets its own full boxed ring stacked directly on
   the one above/below it, which will read as a stack of separate boxes rather than a clean menu
   list (no divider or gap information visible in the source beyond the popover's own internal
   flex gap).
7. **settings-ledger.svelte:149** — "Restore" in a change-history `<Sheet>`, one per list `<li>`
   with `gap-12` between rows — a legitimate isolated per-row action button; ring reads as a
   normal quiet button here, rows are spaced enough not to visually merge.
8. **settings-row.svelte:226** — "Revert" sitting inline beside a "Was: X" neutral `Badge`, shown
   only while a setting is staged, on every settings row across the app (a very repeated pattern)
   — now shows as a tiny ringed box next to the badge on each staged row; not wrong per se, but it
   is the single most-repeated call site, so its visual weight compounds down a long settings
   page.
9. **network-speed-test/+page.svelte:117** — "Cancel" beside a `secondary` "Pause" button in the
   masthead actions, shown only in the `running` phase — reads as an ordinary tertiary action
   next to a stronger one; fine.
10. **data-table-column-filter.svelte:181** — standalone "Clear" button in the filter popover's
    action row (`mc-table-filter-actions`, `justify-end`) — single button, reads fine.
11. **data-table-column-filter.svelte:168** (conditional: `ghost` when not the active preset,
    `secondary` when active) — a *vertical, full-width, stretch* list of date-range presets
    (`mc-table-filter-presets`: `flex-direction: column; align-items: stretch; gap: var(--mc-space-4)`,
    per the component's own comment "a vertical list of quick-range presets… not a nested
    calendar") — **flag, most significant of the set**: every inactive preset button is now a
    full-width ringed box stacked with only 4px between rings, while the active one is a solid
    `secondary` fill. This is exactly the "several ghost buttons in a row forming an unintended
    grid" case the plan called out to watch for — here it's a column, and the tight 4px gap
    between full-width rings will likely read as a single bordered block subdivided into cells
    (a mini table) rather than a list of independent quick-filter buttons. Strongly worth the
    owner's attention.
12. **card.stories.svelte:34** — "Archive" beside a primary "Open matter" button in a `Card.Footer`
    — the surrounding `Card` already carries its own `--mc-border-default` outline, so the ghost
    button's matching-weight ring sits nested one level inside an already-bordered container; a
    mild double-box effect, but this is a Storybook demo, not a real app surface.

### Summary of flags for the owner
- **data-table-column-filter.svelte:168** (date-range presets) — highest priority: full-width,
  vertically stacked, 4px-gapped ghost buttons will likely read as a segmented grid/mini-table,
  not a button list.
- **settings-commit-footer.svelte:78** (staged-changes popover list) — a vertical list of ghost
  rows in a popover; may read as stacked boxes rather than a menu.
- **motion-module.svelte:340/341** (Reset curve / Reset all) — two ghost buttons 4px apart may
  read as one segmented control.
- **settings-row.svelte:226** (Revert) — not wrong, but it is the single most-repeated call site
  in the app (once per staged settings row), so its cumulative visual weight down a long settings
  page is worth a glance.

No call site was changed; all are exactly as they were except for the new `.mc-button-ghost` ring
inherited from the shared CSS.

## Fitness test output

`vp test boundaries off-token`:

```
 RUN  C:/dev/magna-carta-worktrees/slice-0-7a-design-system
 ❯ |@magna-carta/design-system| test/fitness/boundaries.test.ts (24 tests | 1 failed) 2170ms
     × no swept file imports @lucide/svelte bare (forward-looking: zero Lucide usage today) 432ms

AssertionError: expected [ …(2) ] to deeply equal []
+ [
+   "apps/web/src/lib/matters/matter-header.svelte:20 [lucide-deep-import] ...",
+   "apps/web/vitest.config.ts:22 [lucide-deep-import] ...",
+ ]

 Test Files  1 failed | 1 passed (2)
      Tests  1 failed | 464 passed (465)
```

This single failure is a pre-existing Lucide bare-import violation in
`apps/web/src/lib/matters/matter-header.svelte` and `apps/web/vitest.config.ts` — files I did not
touch, unrelated to `button.css` or the box-shadow ring. `git status` confirms this worktree is
shared with other in-flight work (several unrelated `docs/specs/*` and `status-lab/*` files are
already modified by other streams). All 464 other tests, including every token-purity check that
covers `button.css`, pass — the box-shadow addition introduced zero new violations.

`pnpm --filter @magna-carta/design-system check`:
```
1783636522617 COMPLETED 2768 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS
```

`pnpm --filter @magna-carta/web run check`:
```
1783636548684 COMPLETED 5396 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS
```

## Commit

See commit hash in the top-level response; commit only touched
`packages/design-system/src/lib/components/button/button.css` per the plan's Step 4.
