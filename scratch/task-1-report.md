# Task 1: Tool presentation module + dependency wiring — report

Worktree: `C:/dev/magna-carta-worktrees/slice-0-7a-design-system`, branch `slice-0-7b-app-shell`.

## What was done

1. **Added the dependency** — `apps/web/package.json`: added `"@magna-carta/tools": "workspace:*"`
   to `dependencies` (placed last, after `@magna-carta/design-tokens`, to keep the block
   alphabetical: `@lucide/svelte` < `@magna-carta/design-system` < `@magna-carta/design-tokens` <
   `@magna-carta/tools`).
2. **Ran `vp install`** from the worktree root — completed; `apps/web/node_modules/@magna-carta/tools`
   resolves to the workspace package; `pnpm-lock.yaml` updated accordingly (included in the commit).
3. **Wrote the failing test** — `apps/web/test/tools-presentation.test.ts`, byte-for-byte the
   content given in the plan's Step 2.
4. **Confirmed it fails** — module-not-found, exactly as expected (see command/output below).
5. **Created the presentation module** — `apps/web/src/lib/tools/tool-presentation.ts`, based on
   the plan's Step 4 content, **adapted to the catalog's actual current shape** (see Concerns/
   Deviations below for why and exactly what changed).
6. **Confirmed the test passes** — 4 of 5 pass; the 5th fails due to a pre-existing, unrelated bug
   in `packages/tools` (out of this task's scope to fix — see below).
7. **Committed** — commit `646e37f`, message `feat(tools): presentation layer for the tools listing`
   (extended with an explanation of the two deviations, see the full message in git log).

## Commands run and full output

### Install

```
$ vp install
```

Completed normally (peer-dependency warnings only, pre-existing and unrelated — `vitest` version
peer mismatches across several apps/packages that predate this change).

### The literal command from the plan does not run in this repo

The plan's exact command,

```
pnpm --filter @magna-carta/web exec vitest run test/tools-presentation.test.ts
```

fails immediately with `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL Command "vitest" not found` — this
repo's `vitest` is a pnpm catalog alias to `npm:@voidzero-dev/vite-plus-test`, which ships **no
`vitest` executable** (only the `vitest`/`vitest/config` importable API that Vite+ consumes
internally). No package in this monorepo has a real `vitest` bin; test execution goes entirely
through the `vp test` CLI (`vp test run [...filters]`), which is `apps/web`'s own equivalent —
`node_modules/.bin/vp` is present, `node_modules/.bin/vitest` is not, in every workspace package
including `apps/web`. I used the working equivalent throughout:

```
vp test run --project web test/tools-presentation.test.ts
```

### Step 3 — confirm the test fails (before the module exists)

```
$ node_modules/.bin/vp test run --project web test/tools-presentation.test.ts
```

```
 ❯ |web| test/tools-presentation.test.ts (0 test)
⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  |web| test/tools-presentation.test.ts [ apps/web/test/tools-presentation.test.ts ]
Error: Cannot find module '../src/lib/tools/tool-presentation.ts' imported from
C:/dev/magna-carta-worktrees/slice-0-7a-design-system/apps/web/test/tools-presentation.test.ts
 Test Files  1 failed (1)
      Tests  no tests
```

Matches the plan's expected failure exactly.

### Step 5 — confirm the test passes (after the module is created)

First attempt hit two more environment-specific failures before landing on the real one (all
documented under Concerns below); final, stable run:

```
$ node_modules/.bin/vp test run --project web test/tools-presentation.test.ts
```

```
 ❯ |web| test/tools-presentation.test.ts (5 tests | 1 failed) 14ms
     × surfaces the whole catalog exactly once 8ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  |web| test/tools-presentation.test.ts > visibleToolGroups (mock all-permissions)
       > surfaces the whole catalog exactly once
AssertionError: expected [ 'ai-text-detection', …(14) ] to deeply equal [ 'ai-text-detection', …(15) ]
- Expected
+ Received
@@ -2,11 +2,10 @@
    "ai-text-detection",
    "attorney-license-lookup",
    "business-entity-lookup",
    "county-property-records",
    "file-converter",
-   "file-decryption",
    "file-hash-integrity",
    "file-repair",
    "file-type-verifier",
    "firm-usage",
    "metadata-scrubber",

 Test Files  1 failed (1)
      Tests  1 failed | 4 passed (5)
```

4/5 tests pass: presentation completeness, icon completeness, subject-group labels, and
canonical group ordering all pass. Only "surfaces the whole catalog exactly once" fails, and it
fails for a reason external to this task's deliverable — see below.

## Concerns / deviations from the plan's literal content

**1. The catalog has moved on since the plan was written (expected adaptation).**
`packages/tools/src/catalog.ts` and `types.ts` now differ from the plan's snapshot:

- `SUBJECT_GROUP_ORDER` has `"files"`, not `"documents"` (renamed in commit `13a744d`,
  "File Repair tool — files subject group + tools:fileRepair permission").
- The catalog has an additional tool, `file-repair` (icon `"wrench"`), not present in the plan's
  hardcoded `TOOL_PRESENTATION`/`TOOL_ICONS`.

Since the plan's own tests derive expectations from the **live** `CATALOG` and
`SUBJECT_GROUP_ORDER` (not hardcoded lists), the module has to match the catalog as it actually
is today, not the plan's snapshot, or the completeness tests fail by design. I added:

- a `file-repair` entry to `TOOL_PRESENTATION` (`"Repair and salvage a damaged or corrupted file."`,
  stage `"soon"`),
- a `wrench` import + entry in `TOOL_ICONS`,
- renamed the `SUBJECT_GROUP_LABELS` key from `documents` to `files` (kept the same label text,
  "Documents & Files"; the plan's original key literally isn't a member of the `SubjectGroup`
  union anymore, so it wouldn't have compiled).

**2. Necessary `apps/web/vitest.config.ts` change (not in the plan's file list).**
As shipped, the "plain node pool" config has no plugins. `@lucide/svelte`'s `icons/*` subpath
exports re-export a **raw `.svelte` source file**, not compiled JS (confirmed directly — even
plain `node -e "import('@lucide/svelte/icons/house')"` throws
`ERR_UNKNOWN_FILE_EXTENSION` for `.svelte`, and Vite's default SSR dependency externalization
hands the import straight to Node the same way). Any module that imports a `@lucide/svelte` icon
component — which `tool-presentation.ts` is required to do — cannot be evaluated at all under the
config as originally written, regardless of test content. I added the base
`@sveltejs/vite-plugin-svelte` plugin (not the full SvelteKit plugin — `$lib` still doesn't
resolve, per the plan's own note) plus `test.server.deps.inline: ["@lucide/svelte"]` so Vite
transforms the `.svelte` file instead of externalizing it to Node. This is scoped to `apps/web`,
not `packages/tools`, so it doesn't touch the forbididden package.

**3. Pre-existing bug in `packages/tools` blocks one assertion — NOT fixed, per this plan's
constraint.**
`packages/tools/src/catalog.ts:133` — the `file-decryption` entry — still has
`subjectGroup: "documents"`. `"documents"` is not a member of `SubjectGroup` (`SUBJECT_GROUP_ORDER`
only has `"files"` since the rename in `13a744d`). This is a real, provable bug, not a matter of
interpretation:

```
$ node_modules/.bin/tsc -p packages/tools/tsconfig.json --noEmit
src/catalog.ts(133,5): error TS2322: Type '"documents"' is not assignable to type
  '"property" | "business-entities" | "people-licenses" | "mailing-shipping" | "printing" |
  "web-domains" | "files" | "diagnostics"'.
```

`packages/tools` currently does not pass its own typecheck, independent of anything in this task.
Practical effect: `toolsByGroup` (used by `visibleToolGroups()`) silently drops `file-decryption`
from every subject-grouped view, because it iterates only `SUBJECT_GROUP_ORDER` and
`"documents"` matches none of those groups. Grepping the app, `tool-presentation.ts` is currently
the **only** consumer of `toolsByGroup` in `apps/web` or `apps/worker` — so this bug hasn't
manifested anywhere yet, but it will affect Task 3's `/tools` page (file-decryption's tile/row
will not render) and the completeness test above until fixed.

Root cause, via `git log -p`: commit `13a744d` ("File Repair tool — files subject group + …")
renamed `documents` → `files` across five sibling catalog entries and in `types.ts`, but did not
touch the `file-decryption` entry (added by a different branch, `decryption-tool`, merged in
separately) — a rename that a merge didn't reconcile because the merge diff never touched that
specific line.

**The fix is one character** (`subjectGroup: "documents"` → `subjectGroup: "files"` at
`packages/tools/src/catalog.ts:133`), and I verified it resolves both the tsc error and the test
failure by applying it locally, then **reverted it** before committing, because
"Domain package `packages/tools` is not modified by this plan" is one of this task's Global
Constraints, stated without carve-outs. I did not judge it my call to override an explicit,
named constraint on a package that other concurrent worktrees/branches may be actively developing
(`file-repair-salvage`, `decryption-tool` per the merge history), even though the fix itself is
small and unambiguous.

**Recommendation:** the owner (or whichever stream owns `packages/tools` right now) applies that
one-line fix directly; Task 3's browser-verification step will otherwise show `file-decryption`
("File Decryption & Recovery") missing from the Documents & Files group on the `/tools` page.

## Files touched

- `C:/dev/magna-carta-worktrees/slice-0-7a-design-system/apps/web/package.json` — added
  `@magna-carta/tools` dependency.
- `C:/dev/magna-carta-worktrees/slice-0-7a-design-system/apps/web/vitest.config.ts` — added the
  Svelte compiler plugin + `deps.inline` for `@lucide/svelte` (necessary supporting fix, not in
  the plan's file list — see Concern 2).
- `C:/dev/magna-carta-worktrees/slice-0-7a-design-system/apps/web/src/lib/tools/tool-presentation.ts`
  — new module (created).
- `C:/dev/magna-carta-worktrees/slice-0-7a-design-system/apps/web/test/tools-presentation.test.ts`
  — new test (created, verbatim from the plan).
- `C:/dev/magna-carta-worktrees/slice-0-7a-design-system/pnpm-lock.yaml` — updated by `vp install`.
- `packages/tools/src/catalog.ts` — **inspected and diagnosed only, not modified** (reverted a
  trial fix; see Concern 3).

Commit: `646e37f` on branch `slice-0-7b-app-shell`.
