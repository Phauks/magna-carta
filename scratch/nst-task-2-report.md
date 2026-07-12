# Task 2 report — the `connection` Worker route

## Scope

Followed Task 2 and Global Constraints exactly from
`docs/specs/2026-07-09-network-speed-test-implementation-plan.md`, in the worktree at
`C:/dev/magna-carta-worktrees/slice-0-7a-design-system` on branch `slice-0-7b-app-shell`.

## Files created (authored, verbatim from the plan)

- `apps/worker/src/routes/tools-connection.ts` — the route module (meta, `defineOpenAPIRoute`
  definition, `registerToolsConnectionRoute`).
- `apps/worker/test/tools-connection.test.ts` — the Miniflare test (401 unauthenticated, path
  present in the emitted contract).

## Files modified (authored)

- `apps/worker/src/app.ts` — one import (`registerToolsConnectionRoute` from
  `./routes/tools-connection.ts`) added beside the other route imports (after the
  `registerFirmUsageRoute` import), and one registration call
  (`registerToolsConnectionRoute(app, chokepoint);`) added immediately after
  `registerFirmUsageRoute(app, chokepoint);`.

## Files regenerated (never hand-edited)

- `apps/worker/openapi/openapi.json` — via `pnpm --filter @magna-carta/worker run emit-openapi`.
- `packages/api-client/src/index.ts`, `sdk.gen.ts`, `types.gen.ts`,
  `@tanstack/svelte-query.gen.ts` — via `pnpm run generate-client`. Diff is purely additive: the
  new `toolsConnection*` exports/types/query-key slotted in alphabetically among existing
  generated symbols; nothing else changed.

No changes were needed to `packages/access-control/src/registry.ts` — the `tools:speedTest`
permission was already present in the registry (line 48), presumably from earlier
scaffolding/another task on this branch.

## Exact commands run and outcomes

1. `vp test tools-connection` (before creating the route) — **failed**, but for an unexpected
   reason first: `Cannot find module './pkg/decryption_core.js' imported from
packages/decryption/src/index.ts`. This is a pre-existing environment gap in this worktree
   (the Rust→wasm artifact for `@magna-carta/decryption` had never been built here) and affects
   every worker test currently, not just this one — confirmed by running `vp test firm-usage`,
   which failed identically. Not caused by this task's changes.

2. `pnpm --filter @magna-carta/decryption run build:wasm` — ran `wasm-pack build
../../crates/decryption-core --target web --out-dir ../../packages/decryption/src/pkg
--release --no-opt`. Succeeded (~3m16s cargo build + wasm-bindgen). Output lands in
   `packages/decryption/src/pkg`, which is gitignored — confirmed not part of this commit's diff.

3. `vp test tools-connection` (re-run) — now failed for the _expected_ reason: route absent
   from the app / contract.

   ```
   ✕ rejects an unauthenticated caller: expected 200 to be 401
   ✕ is registered in the emitted contract: expected undefined to be defined
   ```

4. Created `apps/worker/src/routes/tools-connection.ts` verbatim from the plan.

5. Edited `apps/worker/src/app.ts`: added the import and the registration call.

6. `pnpm --filter @magna-carta/worker run emit-openapi` — output: `Wrote OpenAPI snapshot:
.../apps/worker/openapi/openapi.json`. Confirmed `/api/v1/tools/connection` present via
   grep.

7. `pnpm run generate-client` — output:

   ```
   @hey-api/openapi-ts v0.98.2
   [Job 1] Generating...
   [Job 1] ../../apps/worker/openapi/openapi.json
   [Job 1] ✓ ./packages\api-client\src · 5 files · 2s
   ```

8. `vp test tools-connection openapi-snapshot` — **PASS**:

   ```
   Test Files  2 passed (2)
        Tests  4 passed (4)
   ```

9. Reviewed `git status` / `git diff --stat` for `packages/api-client/` before staging — 4
   files changed, 70 insertions/6 deletions, all additive (new `toolsConnection*` symbols).
   No unrelated drift.

10. Staged exactly the plan's file list:

    ```
    git add apps/worker/src/routes/tools-connection.ts apps/worker/src/app.ts \
      apps/worker/openapi/openapi.json apps/worker/test/tools-connection.test.ts \
      packages/api-client
    ```

11. Committed:
    ```
    git commit -m "feat(tools): connection route reporting the edge's view of the caller"
    ```
    Result: commit `fb6ed3e4603f4a24d475420e749a7435f043b504`
    ```
     8 files changed, 265 insertions(+), 6 deletions(-)
     create mode 100644 apps/worker/src/routes/tools-connection.ts
     create mode 100644 apps/worker/test/tools-connection.test.ts
    ```

## Commit hash

`fb6ed3e4603f4a24d475420e749a7435f043b504`

## Concerns

- **Environment gap fixed as a side effect, not part of the plan's steps**: the
  `@magna-carta/decryption` wasm build artifact was missing in this worktree and blocked _every_
  worker test, not just this task's. I built it (`pnpm --filter @magna-carta/decryption run
build:wasm`) so Task 2's tests could run at all. The output directory
  (`packages/decryption/src/pkg`) is gitignored, so nothing from that build is in this commit —
  but any other agent/task working in this same worktree that hit worker-test failures citing
  `decryption_core.js` was very likely hitting this same pre-existing gap, now resolved locally.
  This is a local build artifact only; it does not persist across a fresh clone/worktree.
- Left untouched, as out of scope for Task 2: `docs/specs/2026-07-08-matter-data-seam-and-mock-mode-plan.md`
  (untracked) and `scratch/` (this report's directory) — pre-existing untracked items unrelated
  to this task.
- Did not run the broader `pnpm check` / `vp test` full suite — only the two named test files
  per the plan's Step 6, plus the two-command confirmation sequence (fail-then-pass) the TDD
  steps call for.

---

# Follow-up: review-findings fix pass (2026-07-09)

## Scope

Applied two review findings against the already-committed `tools/connection` route, in the same
worktree (`slice-0-7b-app-shell` branch). No redesign — expand the test file, add one comment.

## Finding 1 — expanded `apps/worker/test/tools-connection.test.ts`

Read `apps/worker/test/firm-usage.test.ts` first to mirror its house pattern (seeding/auth
helpers, 401/403/200/OpenAPI-metadata shape). One deviation was required and is called out in a
code comment: no seeded role grants `tools:speedTest` (unlike `tools:firmUsage`/`tools:whois`,
which Owner/Admin holds via committed per-firm baseline SQL — confirmed by grepping
`packages/database/drizzle/per-firm/*.sql`, no hit for `speedTest`). So the 200 case seeds the
permission via a direct grant (`INSERT INTO direct_grant ...`), mirroring the
`mirrorMemberWithDirectGrant` helper already established in
`apps/worker/test/time-entries-routes.test.ts`, rather than through `mirrorMemberWithOwnerRole`.

Added tests (existing 401 and "registered in the emitted contract" tests kept unchanged):

1. 403 for an authenticated member holding no permission (`seedCredentialedUser` with no role
   assignment — same "present but permission-less" pattern as `firm-usage.test.ts`'s
   `usage-noperm@example.com`).
2. 200 for a member holding `tools:speedTest` via direct grant — asserts the exact body
   `{ ip: "", asn: 0, asOrganization: "", colo: "", country: "" }`. Under Miniflare `request.cf` is
   undefined and no `CF-Connecting-IP` header is sent by `SELF.fetch`, so every field lands on the
   handler's documented local-runtime degradation (0 / "") — asserted as the real, deterministic
   value here, not fabricated edge data.
3. The `x-mc-*` / `operationId` OpenAPI-document assertion, matching `firm-usage.test.ts`'s
   (and `whois-route.test.ts`'s) structure exactly (`toolsConnection.get`, `surface: "app"`,
   `authenticated: true`, `permission: "tools:speedTest"`, `resource: "firm"`, `audited: false`).
4. Added `content-type: application/problem+json` assertion to the existing 401 test.

## Finding 2 — one comment in `apps/worker/src/routes/tools-connection.ts`

Added a 3-line comment directly above the `ConnectionResponse` zod schema stating Cloudflare
populates `request.cf` on every production request, and that the handler's empty-string/zero
substitutions are the local-runtime degradation, not meaningful values. No code or `description`
string changed — confirmed by `git diff` showing only the comment added (3 insertions, 0
deletions to any executable line).

## Commands run and full output

1. `vp test tools-connection` — first two attempts hit transient environment failures unrelated
   to the change (`fatal error: out of memory allocating heap arena map` / `spawn ENOMEM`, then an
   `AggregateError` from a Windows file-open glitch on `BreakStatement.js` inside `node_modules`
   during Vite project resolution — both consistent with heavy concurrent load on this dev box
   from other agents/worktrees). Third attempt:

   ```
   Test Files  1 passed (1)
        Tests  5 passed (5)
      Duration  57.20s
   ```

   (5 = the original 2 plus the 3 new: 403, 200, x-mc metadata.)

2. `vp test openapi-snapshot`:

   ```
   Test Files  1 passed (1)
        Tests  2 passed (2)
      Duration  30.22s
   ```

   No contract drift — confirms the route shape itself was not touched, only the comment.

3. `git status --porcelain -- apps/worker/test/tools-connection.test.ts
apps/worker/src/routes/tools-connection.ts` and `git diff -- apps/worker/src/routes/tools-connection.ts`
   — confirmed only the intended two files changed, and the route diff is exactly the 3-line
   comment.

4. Staged and committed exactly the two owned files:
   ```
   git add apps/worker/test/tools-connection.test.ts apps/worker/src/routes/tools-connection.ts
   git commit -m "test(tools): exercise the connection route's permission gate and response shape"
   ```
   Result: `3c72ce4b5a580cfeb51b9ec83f91cee2c954626d` — `2 files changed, 98 insertions(+), 2 deletions(-)`.

## Commit hash

`3c72ce4b5a580cfeb51b9ec83f91cee2c954626d`

## Concerns

- None outstanding. The `tools:speedTest` direct-grant deviation from `firm-usage.test.ts`'s
  Owner/Admin-role pattern is deliberate and documented inline in the test file's helper comment —
  no seeded role currently carries `tools:speedTest`, so `mirrorMemberWithOwnerRole` would not have
  produced a 200 case.
- Did not touch `apps/web/src/lib/tools/speed-test/` or `apps/web/test/`, per the concurrent-agent
  boundary; did not run the full `pnpm check` / `vp test` suite, only the two named targets this
  task calls for.
