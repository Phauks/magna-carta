# Task 2: Persisted view preference — report

## What was done

Followed the TDD steps from Task 2 of
`docs/specs/2026-07-08-tools-listing-page-implementation-plan.md` verbatim (code and commit
message copied exactly as given), using `vp test tools-view-preference` in place of the plan's
`pnpm --filter @magna-carta/web exec vitest run ...` command (per the correction: that binary
isn't on PATH in this worktree).

1. Created `apps/web/test/tools-view-preference.test.ts` with the exact test content from the
   plan.
2. Ran `vp test tools-view-preference` — confirmed it failed (module not found), as expected.
3. Created `apps/web/src/lib/tools/tools-view-preference.ts` (pure module: `ToolsView` type,
   `DEFAULT_VIEW`, `TOOLS_VIEW_STORAGE_KEY`, `parseToolsView`) with the exact content from the
   plan.
4. Ran `vp test tools-view-preference` again — 3/3 tests passed.
5. Created `apps/web/src/lib/tools/tools-view-preference.svelte.ts` (the rune store:
   `toolsView()`, `setToolsView()`, localStorage persistence + cross-tab `storage` event sync)
   with the exact content from the plan.
6. Re-ran `vp test tools-view-preference` to confirm nothing broke — still 3/3 passed.
7. Staged exactly the three files the plan's commit step names and committed with the exact
   message `feat(tools): persisted tiles/list view preference`.

No files outside the plan's Task 2 file list were modified. `packages/tools` was not touched.
Task 1's files (`apps/web/src/lib/tools/tool-presentation.ts`,
`apps/web/test/tools-presentation.test.ts`, `apps/web/package.json`) already existed in the
worktree prior to this task (a previous Task 1 pass) — left untouched.

## Exact commands and full output

### Step 2 — confirm failing (before creating the pure module)

Command: `vp test tools-view-preference`

```
 RUN  C:/dev/magna-carta-worktrees/slice-0-7a-design-system

 ❯ |web| test/tools-view-preference.test.ts (0 test)

⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  |web| test/tools-view-preference.test.ts [ apps/web/test/tools-view-preference.test.ts ]
Error: Cannot find module '../src/lib/tools/tools-view-preference.ts' imported from C:/dev/magna-carta-worktrees/slice-0-7a-design-system/apps/web/test/tools-view-preference.test.ts
...
 Test Files  1 failed (1)
      Tests  no tests
   Start at  16:02:07
   Duration  346ms (transform 39ms, setup 0ms, import 0ms, tests 0ms, environment 0ms)
```

### Step 4 — confirm passing (after creating the pure module)

Command: `vp test tools-view-preference`

```
 RUN  C:/dev/magna-carta-worktrees/slice-0-7a-design-system


 Test Files  1 passed (1)
      Tests  3 passed (3)
   Start at  16:02:29
   Duration  352ms (transform 46ms, setup 0ms, import 111ms, tests 4ms, environment 0ms)
```

### After creating the rune store (sanity re-run)

Command: `vp test tools-view-preference`

```
 RUN  C:/dev/magna-carta-worktrees/slice-0-7a-design-system


 Test Files  1 passed (1)
      Tests  3 passed (3)
   Start at  16:02:49
   Duration  289ms (transform 40ms, setup 0ms, import 59ms, tests 4ms, environment 0ms)
```

## Commit

Hash: `b73385c`
Message: `feat(tools): persisted tiles/list view preference`
Files: `apps/web/src/lib/tools/tools-view-preference.svelte.ts`,
`apps/web/src/lib/tools/tools-view-preference.ts`, `apps/web/test/tools-view-preference.test.ts`
(3 files changed, 91 insertions)

## Concerns

None. The rune store (`tools-view-preference.svelte.ts`) is not covered by a unit test — per the
plan's own comment in the test file, "the rune store and its localStorage/cross-tab wiring are
browser-verified," so that is by design, not an oversight of this task. `vp install` was not
re-run (not needed for this task; Task 1's dependency wiring was already in place). Pre-existing
untracked files in the worktree (`docs/specs/2026-07-08-matter-data-seam-and-mock-mode-plan.md`,
`scratch/`) were left alone and not staged.
