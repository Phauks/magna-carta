# Task 3 report — tile + row components, the page, and the destination flip

## Files created

- `C:/dev/magna-carta-worktrees/slice-0-7a-design-system/apps/web/src/lib/tools/tool-tile.svelte`
- `C:/dev/magna-carta-worktrees/slice-0-7a-design-system/apps/web/src/lib/tools/tool-row.svelte`
- `C:/dev/magna-carta-worktrees/slice-0-7a-design-system/apps/web/src/routes/(app)/tools/+page.svelte`

## Files modified

- `C:/dev/magna-carta-worktrees/slice-0-7a-design-system/apps/web/src/lib/navigation/destinations.ts` — `tools` entry: `shipped: false, announced: true` → `shipped: true, stage: "alpha"` (the `announced: true` line removed, as specified).
- `C:/dev/magna-carta-worktrees/slice-0-7a-design-system/apps/web/src/lib/tools/tool-presentation.ts` — added two accessor functions (`toolPresentation`, `toolIcon`); see "Deviation: typecheck" below. `TOOL_PRESENTATION`/`TOOL_ICONS`/`SUBJECT_GROUP_LABELS`/`visibleToolGroups` (Task 1's committed surface) are untouched.

Note: Task 1's already-committed `tool-presentation.ts` differs from the plan's Task 1 listing in two harmless ways (not introduced by me): `SUBJECT_GROUP_LABELS.files` instead of `.documents` (matches the real `SubjectGroup` union, which is `files` not `documents`), and an extra `file-repair` catalog entry + `wrench` icon. Mentioned for the coordinator's awareness only.

## Deviations from the plan's example markup, and why

1. **Group header treatment.** Did not use the plan's `style="font-variant: small-caps"`. Read `settings-plate.svelte` and `section-stub.svelte`: the house group-header idiom for a page-level section is

   ```
   <h2 class="border-b border-border-strong pb-8 text-xs text-text-muted uppercase" style="letter-spacing: var(--mc-tracking-caps)">
   ```

   (confirmed a third time against `matters/[id]/overview/+page.svelte`'s "Key facts" heading, which uses the exact same classes for the exact same job — a page's own section heading, not a settings plate). Used that verbatim instead of small-caps.

2. **Tailwind spacing scale is a closed pixel set, not Tailwind's default multiplier scale.** Checked `packages/design-tokens/generated/tailwind-theme.css`: `--spacing-*` is only defined at `0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 96` (pixel values), with no generic `--spacing` base for Tailwind v4's arbitrary-N calc formula. That means a class like `gap-3`, `size-5`, `py-3`, `mt-2`, or `gap-1` (all used in the plan's example markup) resolves to **no CSS at all** — not an error, just silently missing spacing. I replaced every such class with the nearest real token step, and matched icon sizing to the codebase-wide convention of `size-16` (confirmed via ~35 existing `size-16` icon usages; the plan's `size-5`/`size-4` have no house precedent and one is off-token). Went through `gap-8`, `gap-16`, `gap-32`, `px-16`, `py-12`, `mb-24`, `mb-32` instead.

   By contrast, the plan's `hover:bg-surface-raised` and `divide-border-default` (flagged as "invented" in the task brief) turned out to **already be real, in-use classes** — `hover:bg-surface-raised` in `settings-row.svelte`/`settings/+layout.svelte`, `divide-border-default` in `settings-plate.svelte`/`settings/versions/+page.svelte` — both backed by real tokens (`--color-surface-raised`, `--color-border-default`). Kept both as-is.

3. **Card composition.** Confirmed `Card.Root`/`Card.Header`/`Card.Title`/`Card.Description` all accept a `class` prop (each is a thin wrapper forwarding `HTMLAttributes` through `mergeClasses`). Used the canonical composition from `card.stories.svelte` (`Card.Root > Card.Header > Card.Title + Card.Description`) rather than the plan's flat `Card.Root > div > Card.Title` + sibling `Card.Description` — `Card.Header` already carries the right inline padding and vertical gap, so the tile doesn't need to invent its own.

4. **Masthead margin and toggle-group construction.** Used `Masthead.Root class="mb-24"` (matches `matters/+page.svelte`'s convention) instead of the plan's `mb-12`. Built the tiles/list toggle as two `Button` instances with `size="icon"` (a real, self-contained square button size in the button recipe) rather than leaving size unset; `gap-4` between them reads as a segmented pair. `role="group"` + `aria-label="Choose a view"` and `aria-pressed` on each button kept as specified.

5. **`noUncheckedIndexedAccess` typecheck fix (new, not called out in the brief).** `svelte-check` failed on `TOOL_PRESENTATION[tool.id]` / `TOOL_ICONS[tool.icon]` in the page: both maps are `Record<string, T>`, and this project's `tsconfig` (`apps/web/tsconfig.json` + `tsconfig.base.json`) sets `noUncheckedIndexedAccess: true`, so an indexed read types as `T | undefined` regardless of the key. Added two small accessor functions to `tool-presentation.ts` — `toolPresentation(tool)` and `toolIcon(tool)` — that read the map and throw if the entry is missing (the completeness test guarantees it never is; the throw exists only to make the type assertion honest, not because it's expected to fire). The page and both components call these instead of indexing the maps directly. `TOOL_PRESENTATION`/`TOOL_ICONS` themselves, and Task 1's test, are unchanged.

## Commands run and output

- `pnpm --filter @magna-carta/web run check` → **0 ERRORS 0 WARNINGS** (5356 files) after the accessor fix (first run surfaced 4 `noUncheckedIndexedAccess` errors, fixed as above and re-run clean).
- `vp test tools-presentation tools-view-preference` → **2 test files, 8 tests passed.**
- Svelte MCP `svelte-autofixer` run on all three new/changed `.svelte` files (`tool-tile.svelte`, `tool-row.svelte`, `+page.svelte`) both before and after the accessor-fix edit — clean (`issues: [], suggestions: []`) every time.

## Commit

`6e45628` — `feat(tools): /tools listing page with tiles/list toggle`, on branch `slice-0-7b-app-shell`, 5 files changed (3 created, 2 modified): `tool-tile.svelte`, `tool-row.svelte`, `(app)/tools/+page.svelte`, `destinations.ts`, `tool-presentation.ts`.

## Concerns

- None blocking. The `noUncheckedIndexedAccess` gap wasn't anticipated by the plan; the fix is small, contained to `tool-presentation.ts`, and doesn't touch either of Task 1's exported map shapes or its test.
- Did not touch the untracked `docs/specs/2026-07-08-matter-data-seam-and-mock-mode-plan.md` sitting in the worktree (not part of this task, left alone) and did not commit `scratch/` (this report's own directory).
- Did not start a dev server or do browser verification per instructions — that's the coordinator's step.

## Follow-up: review-fix pass (Findings 1 & 2)

Two small review findings applied to the already-committed tile/row, in the same two files only.

### Finding 1 — inconsistent hover affordance on the launchable branch

`tool-row.svelte`'s launchable `<a>` had `hover:bg-surface-raised`; `tool-tile.svelte`'s launchable `<a>` had none. Read `apps/web/src/lib/developer/sitemap-node.svelte` (its launchable `<a>` uses `hover:bg-surface-sunken`, and its non-launchable toggle `<button>` uses `hover:bg-surface-sunken` too — sunken is that component's family, not the relevant precedent) and `apps/web/src/lib/settings/components/settings-row.svelte` (the interactive row wrapper: `class="... {interactive ? 'hover:bg-surface-raised' : ''}"`, i.e. `bg-surface-raised` is the house token for an interactive row/card hover, matching `tool-row.svelte` exactly). Confirmed `surface-raised` is a real, generated token (`--color-surface-raised` in `packages/design-tokens/generated/tailwind-theme.css`, also used in `card.css`, `dialog.css`, `sheet.css`, `data-table.css`, `alert-dialog.css`, `resizable.css`) — not an invented class.

Added `hover:bg-surface-raised` to `tool-tile.svelte`'s launchable anchor, so it now reads:

```
<a href={`/tools/${tool.id}`} class="block h-full rounded-lg hover:bg-surface-raised">{@render body()}</a>
```

This matches `tool-row.svelte`'s existing `<a href={...} class="block hover:bg-surface-raised">`. No new custom CSS, no motion added (none was present or requested; the finding only asked for a background-color hover, which is not a transform/opacity motion concern).

### Finding 2 — remove inert `aria-disabled="true"`

Removed `aria-disabled="true"` from the non-launchable `<div>` in both `tool-tile.svelte` (`<div class="h-full">{@render body()}</div>`) and `tool-row.svelte` (`<div>{@render body()}</div>`). Nothing added in its place — the `MaturityBadge` already carries the "not yet" meaning, matching the component's own doc comment ("no disabled styling that would read as broken").

### Commands run and output

- `svelte-autofixer` (MCP, desired_svelte_version 5) on both updated files — clean (`issues: [], suggestions: []`) for both.
- `pnpm --filter @magna-carta/web run check` → `1783618279328 START ... COMPLETED 5357 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS`.
- `vp test tools-presentation tools-view-preference` → `Test Files  2 passed (2)` / `Tests  8 passed (8)`.

### Commit

`6436858` — `fix(tools): consistent hover affordance on a launchable tile; drop inert aria-disabled`, 2 files changed, 3 insertions(+), 3 deletions(-): `tool-tile.svelte`, `tool-row.svelte`.

### Concerns

None. Both fixes are narrow, match an existing house convention exactly (no new class invented), and the branch remains unexercised by any route (every tool is still `soon`), so the check/typecheck/test results above are the full verification surface available.
