# Task 1 report: `hasSurface` in the maturity module

## What changed

Followed the plan's TDD steps exactly, verbatim.

1. **Created** `apps/web/test/maturity-has-surface.test.ts` — three tests asserting `hasSurface`
   returns `false` only for `"soon"` and `true` for every other `MaturityStage` member (derived
   from `MATURITY_PRESENTATION`'s keys, so a future stage cannot go unclassified).
2. **Modified** `apps/web/src/lib/maturity/maturity.ts` — appended `hasSurface(stage: MaturityStage): boolean`
   after `MATURITY_PRESENTATION`, returning `stage !== "soon"`.
3. **Modified** `apps/web/src/lib/tools/tool-tile.svelte` — added
   `import { hasSurface } from "$lib/maturity/maturity.ts";` and changed
   `const launchable = $derived(presentation.stage === "ready");` to
   `const launchable = $derived(hasSurface(presentation.stage));`. Nothing else in the file touched.
4. **Modified** `apps/web/src/lib/tools/tool-row.svelte` — identical import + derivation change.
   Nothing else in the file touched.

## Commands run (exact) and full output

### Step 1/2 — write test, confirm it fails

Command: `cd C:/dev/magna-carta-worktrees/slice-0-7a-design-system && vp test maturity-has-surface`

Result: **FAIL** as expected — `hasSurface is not a function` (3 failures), e.g.:

```
FAIL  |web| test/maturity-has-surface.test.ts > hasSurface > is false only for soon
TypeError: hasSurface is not a function
 ❯ test/maturity-has-surface.test.ts:...

FAIL  |web| test/maturity-has-surface.test.ts > hasSurface > is true for every stage that has a surface
TypeError: hasSurface is not a function

FAIL  |web| test/maturity-has-surface.test.ts > hasSurface > classifies every stage in the model
TypeError: hasSurface is not a function

 Test Files  1 failed (1)
      Tests  3 failed (3)
```

### Step 3/4 — add `hasSurface`, confirm it passes

Command: `cd C:/dev/magna-carta-worktrees/slice-0-7a-design-system && vp test maturity-has-surface`

Result: **PASS**

```
 RUN  C:/dev/magna-carta-worktrees/slice-0-7a-design-system

 Test Files  1 passed (1)
      Tests  3 passed (3)
   Start at  11:25:21
   Duration  1.35s (transform 92ms, setup 0ms, import 538ms, tests 10ms, environment 0ms)
```

### Step 6 — Svelte/TS gate

Command: `cd C:/dev/magna-carta-worktrees/slice-0-7a-design-system && pnpm --filter @magna-carta/web run check`

Result:

```
> @magna-carta/web@0.0.0 check
> svelte-check --tsconfig ./tsconfig.json

The following Vite config options will be overridden by SvelteKit:
  - root
1783621575765 START "...\apps\web"
1783621575838 COMPLETED 5358 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS
```

0 errors, 0 warnings, as required.

### Step 7 — stage and commit

```
git add apps/web/src/lib/maturity/maturity.ts apps/web/src/lib/tools/tool-tile.svelte apps/web/src/lib/tools/tool-row.svelte apps/web/test/maturity-has-surface.test.ts
git commit -m "fix(tools): a built tool is launchable at any stage above soon"
```

`git status --short` immediately before the commit showed exactly the four intended files staged
(plus two pre-existing untracked items in the worktree — `docs/specs/2026-07-08-matter-data-seam-and-mock-mode-plan.md`
and `scratch/` — which were left alone and not included in the commit).

Commit result:

```
[slice-0-7b-app-shell 78a006f] fix(tools): a built tool is launchable at any stage above soon
 4 files changed, 47 insertions(+), 2 deletions(-)
 create mode 100644 apps/web/test/maturity-has-surface.test.ts
```

## Commit hash

`78a006f`

## Concerns

None. The two `.svelte` files were changed only in the import line and the `launchable` derivation,
exactly as scoped — the anchor/`div` branches were untouched and did not need to be, since they already
branch on `launchable`. The maturity module's new export sits directly beside `MATURITY_PRESENTATION`,
keeping the "one home" rule the module already asserts about itself. Pre-existing untracked files in
the worktree (`docs/specs/2026-07-08-matter-data-seam-and-mock-mode-plan.md`, `scratch/`) are unrelated
to this task and were not touched or staged.
