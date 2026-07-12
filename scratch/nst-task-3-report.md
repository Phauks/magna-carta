# Task 3: Pure frontend logic — formatting and probe math

## Files created

- `apps/web/src/lib/tools/speed-test/speed-test-format.ts`
- `apps/web/src/lib/tools/speed-test/connection-probe.ts`
- `apps/web/test/speed-test-format.test.ts`
- `apps/web/test/connection-probe.test.ts`

All four created verbatim per the plan's Task 3 code blocks (no deviations).

## TDD steps followed

### Step 1-2: Failing formatting test

Created `apps/web/test/speed-test-format.test.ts`, then ran:

```
cd "C:/dev/magna-carta-worktrees/slice-0-7a-design-system"
vp test speed-test-format
```

Result: FAIL as expected — `Cannot find module '../src/lib/tools/speed-test/speed-test-format.ts'`.

### Step 3-4: Implement formatting module, verify pass

Created `apps/web/src/lib/tools/speed-test/speed-test-format.ts` with `formatBandwidth` and
`formatMilliseconds`. Ran:

```
vp test speed-test-format
```

Result: PASS — `Test Files 1 passed (1)`, `Tests 6 passed (6)`.

### Step 5-6: Failing probe test

Created `apps/web/test/connection-probe.test.ts`, then ran:

```
vp test connection-probe
```

Result: FAIL as expected — `Cannot find module '../src/lib/tools/speed-test/connection-probe.ts'`.

### Step 7-8: Implement probe module, verify pass

Created `apps/web/src/lib/tools/speed-test/connection-probe.ts` with `ConnectionFacts`,
`ProbeOutcome`, `ProbeDeps`, `PROBE_SAMPLES`, `CONNECTION_URL`, `median`, and `probeConnection`.
Ran:

```
vp test connection-probe speed-test-format
```

Result: PASS — `Test Files 2 passed (2)`, `Tests 12 passed (12)`.

### Step 9: Commit

```
cd "C:/dev/magna-carta-worktrees/slice-0-7a-design-system"
git add apps/web/src/lib/tools/speed-test/speed-test-format.ts apps/web/src/lib/tools/speed-test/connection-probe.ts apps/web/test/speed-test-format.test.ts apps/web/test/connection-probe.test.ts
git commit -m "feat(tools): speed-test formatting and connection-probe math"
```

Only the four owned files were staged (verified via `git status --short` before commit — no
other pending worktree files, e.g. `docs/specs/2026-07-08-matter-data-seam-and-mock-mode-plan.md`
and `scratch/`, were included).

Commit result:

```
[slice-0-7b-app-shell a583d98] feat(tools): speed-test formatting and connection-probe math
 4 files changed, 199 insertions(+)
 create mode 100644 apps/web/src/lib/tools/speed-test/connection-probe.ts
 create mode 100644 apps/web/src/lib/tools/speed-test/speed-test-format.ts
 create mode 100644 apps/web/test/connection-probe.test.ts
 create mode 100644 apps/web/test/speed-test-format.test.ts
```

Commit hash: `a583d98938105eae7b9b13d4c1cde2361f28d4f9`

Note: the `git commit` bash invocation printed a transient Cygwin fork-retry warning
(`cygheap read copy failed` / `Resource temporarily unavailable`) to stderr before succeeding —
this is a Windows/Cygwin bash subprocess artifact, not a git error. The commit completed
successfully and `git rev-parse HEAD` after the fact confirms the hash above with a clean
`git status` (only pre-existing untracked files from other work remain).

## Concerns

None. Both test files and both source modules match the plan's code blocks exactly (byte-for-byte
as given, including the em-dash `—` character and the `noUncheckedIndexedAccess`-safe `median`
guards). No browser APIs are referenced at module scope in either module — `probeConnection`
takes `fetchJson` and `now` as injected dependencies as required. Did not touch anything under
`apps/worker/`.
