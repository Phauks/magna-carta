# Task 3 review — tile + row components, the /tools page, destination flip

Commit reviewed: `6e45628` (range `b73385c0..6e45628`), branch `slice-0-7b-app-shell`.

## Method

Read the plan's Task 3 + Global Constraints, the implementer report, and the full diff, then
cross-checked every deviation claim against the actual source (not taken on faith):

- `apps/web/src/lib/matters/section-stub.svelte`, `matters/[id]/overview/+page.svelte`, `matters/+page.svelte`
- `packages/design-tokens/generated/tailwind-theme.css` (spacing + radius scales)
- `packages/design-system/src/lib/components/{card,button,masthead}/*`
- `apps/web/src/lib/maturity/{maturity.ts,maturity-badge.svelte}`
- `apps/web/src/lib/navigation/destinations.ts` (`Destination` type, `destinationStage`)
- `packages/tools/src/select.ts` (`toolsByGroup`/`GroupedTools`)
- house convention for hover-affordanced links (`sitemap-node.svelte`, `settings-row.svelte`, `settings/+layout.svelte`)

## Verified findings

**Token-purity audit was real, not asserted.** `--spacing-*` in `tailwind-theme.css` is a closed
pixel set (`0,4,8,12,16,20,24,32,40,48,64,96`) with no generic multiplier base — confirms the
plan's example classes (`gap-3`, `size-5`, `py-3`, `mt-2`, `gap-1`) would silently resolve to no
CSS. The implementer's replacements (`gap-8`/`gap-16`/`gap-32`/`px-16`/`py-12`/`mb-24`/`mb-32`,
`size-16`) are all real steps on that scale. `rounded-lg` also checks out against `--radius-lg:
10px` and is in active use elsewhere (`app-shell.svelte`, `command-palette.svelte`).

**Group-header treatment is a verbatim match**, not just plausible — `border-b
border-border-strong pb-8 text-xs text-text-muted uppercase` + `letter-spacing:
var(--mc-tracking-caps)` is character-for-character the same idiom used by
`section-stub.svelte:15-17` and the "Key facts"/"Description" headings in
`matters/[id]/overview/+page.svelte:76-78`. Correct reuse, not an invented pattern.

**`hover:bg-surface-raised` / `divide-border-default` are real, in-house classes** — confirmed in
`settings-row.svelte`, `settings/+layout.svelte`, `settings-plate.svelte`, `settings/versions/+page.svelte`, backed by `--color-surface-raised` / `--color-border-default`. Correctly kept.

**Card composition** (`Card.Root > Card.Header > [icon+Title+badge row] + Description`) matches
the component contract in `card.css` (root: 24px rhythm/padding; header: 4px gap, 24px inline
padding) — no invented double-padding, no redundant `mt-2` needed since `Card.Header`'s own gap
covers it.

**`Button size="icon"`** is a real `ButtonSize` variant (`packages/design-system/.../button/variants.ts`), not invented.

**Destination flip is exact**: `shipped: true`, `stage: "alpha"`, `announced` line removed, `defaultStarred`/`icon`/`description`/`group`/`href` untouched. `stage` is a documented optional field on `Destination` (`destinations.ts:86-92`) so this is a correct, in-contract use, not a new field.

**Launchable seam is sound.** `MaturityBadge` renders `null` at `stage: "ready"` (`maturity.ts:51`,
`maturity-badge.svelte:15-17`), so a shipped tool's tile/row shows no badge and the whole
tile/row becomes the link (`launchable = presentation.stage === "ready"`); below `ready` it's a
plain `<div aria-disabled="true">` with the badge (e.g. "Soon") carrying the meaning, exactly per
spec. Both components implement the identical rule.

**Same content, two layouts.** The page computes `groups` once and both branches (`{#if view ===
"tiles"}` / `{:else}`) iterate the same `tools` array, passing the same `{tool, presentation,
icon}` to `ToolTile`/`ToolRow` — no drift between views.

**Accessibility of the toggle**: `role="group"` + `aria-label="Choose a view"` on the wrapper;
each `Button` carries `aria-label` (`"Tile view"`/`"List view"`) and `aria-pressed={view ===
...}`. `Button` has no `href`, so it renders a native `<button>` and spreads `restProps`
(including `aria-*`) onto it (`button.svelte:54-62`) — attributes land correctly, not swallowed.

**Svelte 5 idioms**: `$props()`, `$derived`, snippets (`{#snippet body()}`/`{@render body()}`)
used correctly in both components; no `export let`, no `$:`, in any of the three new files.

**No process-doc references** in any of the four touched/created files (grepped for
`ADR-`, `spec §`, `Phase N`, `slice N`, `Task N` — no matches).

**The `noUncheckedIndexedAccess` fix is sound and honestly framed.** `toolPresentation(tool)` /
`toolIcon(tool)` throw loudly on a missing key rather than fabricating a placeholder — the
correct choice, since a silent fallback would let a catalog/table drift render wrong content
without ever failing a test. The throw is guarded by Task 1's completeness test (`tools-presentation.test.ts`), so it is a real invariant, not a hypothetical. Scope is contained to
`tool-presentation.ts`; Task 1's committed exports (`TOOL_PRESENTATION`, `TOOL_ICONS`,
`SUBJECT_GROUP_LABELS`, `visibleToolGroups`) and its test are untouched.

## Findings

**Important — tile/row hover-affordance inconsistency (currently latent).**
`tool-row.svelte:30` gives its launchable anchor `hover:bg-surface-raised`; `tool-tile.svelte:38`
gives its launchable anchor only `class="block h-full rounded-lg"` — no hover treatment at all.
House convention for a link/row (`sitemap-node.svelte:39,46`, `settings-row.svelte:113`,
`settings/+layout.svelte:131`) is to always pair an interactive row with a hover state. Because
every tool is currently `soon`, this branch is unexercised and the gap won't surface until the
first tool ships to `ready` — exactly the kind of "plausible but unverified" gap the task asked
to check for. Recommend adding a hover state to the tile's anchor before the first tool goes
`ready` (not blocking for this merge).

**Minor — `aria-disabled="true"` on a plain, non-interactive `<div>`**
(`tool-tile.svelte:40`, `tool-row.svelte:32`). Harmless (a `div` carries no implicit role, so
assistive tech ignores the attribute), but it doesn't do the job its name implies; the "not yet"
meaning is actually carried by the `MaturityBadge` text, which is correct and sufficient. Cosmetic
only — no action required.

**Minor — accessor throw surfaces as a full-page crash, not a per-tile degradation.**
`toolPresentation`/`toolIcon` are called directly in template prop position
(`+page.svelte:279,287`), so if the invariant they guard ever broke, the whole `/tools` page
would hard-fail rather than one tile going blank. This is the defensible tradeoff given Task 1's
completeness test enforces the invariant at CI time (a broken catalog entry fails the build
before it reaches production) — noting it for awareness, not requesting a change.

## Bottom line

Spec: PASS — all Task 3 deliverables present and correct (tile/row launchable seam, toggle wired
to the persisted preference, identical grouping across both views, exact destination flip, no
`packages/tools` edits), every Global Constraint honored, and the directed deviations (group-header
reuse, token audit) verified as sound rather than assumed.

Quality: Approved — one Important, non-blocking follow-up (hover parity on the tile's launchable
anchor, latent until the first tool ships to `ready`); two Minor cosmetic notes, no action
required.
