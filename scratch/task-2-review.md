# Task 2 review — persisted view preference

## Scope checked

- Requirements: docs/specs/2026-07-08-tools-listing-page-implementation-plan.md, "### Task 2" and "## Global Constraints" only.
- Implementer report: scratch/task-2-report.md
- Review package: scratch/task-2-review-package.md (commit b73385c, range 41985e1..b73385c)

## Files produced (matches Task 2's file list exactly)

- apps/web/src/lib/tools/tools-view-preference.ts (pure)
- apps/web/src/lib/tools/tools-view-preference.svelte.ts (rune store)
- apps/web/test/tools-view-preference.test.ts

`git diff 41985e1..b73385c --name-only` confirms no other files touched; `packages/tools` untouched.

## Interface checklist (against spec's "Interfaces" block)

Pure module — all four required exports present, correctly typed:

- `type ToolsView = "tiles" | "list"` (tools-view-preference.ts:8)
- `DEFAULT_VIEW: ToolsView = "tiles"` (tools-view-preference.ts:10) — matches the required default
- `TOOLS_VIEW_STORAGE_KEY = "mc-tools-view"` (tools-view-preference.ts:12) — matches the existing `mc-` key-prefix precedent (apps/web/src/lib/navigation/sidebar-preferences.svelte.ts:35, `mc-sidebar-preferences`), not shorthand of the golden-rule-12 kind
- `parseToolsView(raw: string | null): ToolsView` (tools-view-preference.ts:14-16) — accepts only `"tiles"`/`"list"`, else `DEFAULT_VIEW`; ternary is a direct, correct rendering of the rule

Store — all required exports present:

- `toolsView(): ToolsView` (tools-view-preference.svelte.ts, reads `state.view`)
- `setToolsView(view: ToolsView): void` (guards no-op on unchanged value, then updates state + persists)
- SSR-safe: `typeof localStorage === "undefined"` / `typeof window !== "undefined"` guards in `readStored`, `persist`, and the listener registration — `typeof` on an undeclared global is safe under SSR/prerender, no ReferenceError
- Reads and writes route through `parseToolsView` on read (`readStored` calls it); writes are already narrowed to `ToolsView` by `setToolsView`'s parameter type, so there is nothing to parse on write — this is correct, not a gap
- Cross-tab sync: `storage` event listener re-reads on `event.key === TOOLS_VIEW_STORAGE_KEY` or `null` (covers `localStorage.clear()`)
- No duplicated parse logic — the store imports `DEFAULT_VIEW`, `TOOLS_VIEW_STORAGE_KEY`, `parseToolsView`, `type ToolsView` from the pure module; DRY confirmed

## Test check

apps/web/test/tools-view-preference.test.ts asserts real behavior, not a no-op:

- valid inputs ("tiles", "list") round-trip unchanged
- null, unknown ("grid"), and empty string all fall back to `DEFAULT_VIEW`
- `DEFAULT_VIEW` itself pinned to `"tiles"`

Report claims 3/3 passing before and after the store was added (not re-run by this review, per instructions). Test lives under apps/web/test/, imports the pure module by relative path (`../src/lib/tools/tools-view-preference.ts`) — matches the global constraint on test location/import style.

The rune store is intentionally not unit-tested (browser-verified per Task 3 Step 8), consistent with the plan's own stated design and with golden rule 10/testing conventions for runes in this app's plugin-less node test pool.

## Process-doc / shorthand scan

`grep -i 'ADR|spec|Phase|slice|Slice|TODO|FIXME'` over both new `.ts` files: no matches. The store's comment references "the sidebar-preferences pattern" — this names an existing sibling module (apps/web/src/lib/navigation/sidebar-preferences.svelte.ts) by its established pattern name, not a process artifact (ADR/spec-section/slice/phase); acceptable under golden rule 13. No emojis found.

## Over-build check

No exports beyond the four (pure) + two (store) the spec requires. No unused abstractions, no extra helper surface, no premature generalization (e.g. no attempt to generalize this into a generic "persisted preference" utility — correctly deferred).

## Findings

None rise to Critical or Important. Two Minor observations, neither blocking:

- **Minor** — tools-view-preference.svelte.ts: the module-level `storage` event listener is registered unconditionally at import time with no teardown/removal path. This matches the existing sidebar-preferences precedent (a singleton, page-lifetime module) rather than being a new pattern, so it's consistent with the codebase, not a defect — flagging only for awareness, no change requested.
- **Minor** — the implementer report notes `vp test` was substituted for the plan's literal `pnpm --filter @magna-carta/web exec vitest run ...` command because the latter binary isn't on PATH in this worktree; this is a tooling-invocation deviation only, not a code deviation — the actual file contents match the plan verbatim.

## Verdicts

**Spec: PASS.** Every Task 2 deliverable (pure module's four exports, store's two exports, SSR guards, cross-tab sync, DRY parse reuse, test at the correct path with correct import style) is present, correct, and matches the interface contract exactly. Nothing missing, nothing extra, `packages/tools` untouched, global constraints (full names, no process-doc refs, no emojis, test location/import style) all satisfied.

**Quality: Approved.** Code is clean, correctly guards SSR/prerender, avoids logic duplication, and the test genuinely pins the one branch worth a unit (not a no-op). No changes requested.

**Bottom line:** Task 2 is complete, correct, and matches the plan and global constraints exactly — approved as-is.
