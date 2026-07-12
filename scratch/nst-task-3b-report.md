# Task 3b report — probe must not blame the network for our own refusal

## Scope

Files touched (exactly the two owned files, nothing else):

- `apps/web/src/lib/tools/speed-test/connection-probe.ts`
- `apps/web/test/connection-probe.test.ts`

## What changed

### Test file (`apps/web/test/connection-probe.test.ts`)

Replaced the `describe("probeConnection", ...)` block verbatim per plan Task 3b Step 1. The
`describe("median", ...)` block was left untouched. New block covers 7 cases: PROBE_SAMPLES
median-on-success, excluding a transport failure (`status: null`), unreachable when every sample
transport-fails, unauthenticated on 401 (stops after 1 call), forbidden on 403 (stops after 1
call), a 500 treated as a transport failure (not a refusal), and a plain reachable case.

### Implementation (`apps/web/src/lib/tools/speed-test/connection-probe.ts`)

- Kept `ConnectionFacts`, `PROBE_SAMPLES`, `CONNECTION_URL`, and `median` unchanged.
- Added `ProbeStatus = "reachable" | "unauthenticated" | "forbidden" | "unreachable"`.
- Added `FetchResult = { ok: true; facts: ConnectionFacts } | { ok: false; status: number | null }`
  (`status: null` = transport failure, distinct from a numeric refusal).
- `ProbeOutcome` now carries `status: ProbeStatus` alongside the existing fields.
- `ProbeDeps.fetchJson` now returns `Promise<FetchResult>` instead of throwing.
- `probeConnection` no longer uses try/catch around `fetchJson`. Each sample's `FetchResult` is
  inspected: on `ok: true` the duration is recorded; on `ok: false` with `status === 401` or `403`
  the loop returns immediately via a `refused(status)` helper (an auth/permission refusal is an
  answer — retrying cannot change it); any other `ok: false` (including `status: null` transport
  failures and server errors like 500) is simply excluded from the sample set and the loop
  continues. If zero samples ever succeeded, the outcome is `"unreachable"`; otherwise
  `"reachable"` with the median round-trip and successful-sample count as before.

## Commands run (exact output)

```
$ vp test connection-probe   # after rewriting the test only (before touching the probe)
...
 Test Files  1 failed (1)
      Tests  7 failed | 3 passed (10)
```

Failures were all `expected undefined to be '<status>'` — confirming `ProbeOutcome.status` did
not yet exist and `fetchJson` was still expected to throw. This is the expected TDD red state.

```
$ vp test connection-probe   # after rewriting the probe module
...
 Test Files  1 passed (1)
      Tests  10 passed (10)
```

All 10 tests pass (3 for `median`, 7 for `probeConnection`), matching the plan's expected count.

```
$ git add apps/web/src/lib/tools/speed-test/connection-probe.ts apps/web/test/connection-probe.test.ts
$ git commit -m "fix(tools): the probe distinguishes a refusal from an unreachable platform"
[slice-0-7b-app-shell 51a39d8] fix(tools): the probe distinguishes a refusal from an unreachable platform
 2 files changed, 89 insertions(+), 19 deletions(-)
```

## Commit hash

`51a39d8cafb72a8d2f000aa3e8e046be295d6b59`

## Concerns

None. The module stays pure and node-safe (no `fetch`, no `performance`, no browser globals at
module scope — dependencies remain injected). `noUncheckedIndexedAccess` guards in `median` were
left untouched. Only the two owned files were staged and committed; the worktree's other
untracked items (`docs/specs/2026-07-08-matter-data-seam-and-mock-mode-plan.md`,
`find.exe.stackdump`, `scratch/`) were left alone.
