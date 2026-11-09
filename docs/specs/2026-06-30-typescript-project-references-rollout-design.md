# TypeScript project-references rollout — design

**Status:** Infra landed (generator + graph + `vp run typecheck` task); the type-check gate is
**deferred** until pre-existing latent type errors are fixed — see _Landing status_ below.
**Date:** 2026-06-30.
**Home for the standing rules:** [`docs/conventions/build-performance.md`](../conventions/build-performance.md)
(_Type-checking and static analysis_). This spec is the point-in-time rollout design; the durable
convention already states the strategy.

## Why

Whole-repo `tsc` type-checking has no incrementality, so its wall-clock scales with _total_ code, not
_changed_ code — a 5+ minute cold check today, worse as the monorepo grows. `oxfmt`/`oxlint` are
already Rust-fast and are not the bottleneck. Project references make the type-check incremental
(package-granular), and pre-wire the later swap to the ~10× native compiler (`tsgo`). Sequenced:
references first (under the mature JavaScript `tsc -b`), native engine second.

## Spike evidence (2026-06-30)

A two-package spike (`identifiers` leaf → `encryption`) validated the mechanics against our real config:

- **composite + references works with our source-`exports` + `moduleResolution: bundler`** — cross-
  package types resolve via TypeScript's source-of-project-reference redirect; no resolution errors.
- **Incremental:** cold `tsc -b` 1601ms → warm no-change 321ms (both projects skipped as up-to-date);
  content-aware (an `mtime`-only `touch` does not recompile).
- **`tsgo -b` (7.0.0-dev.20260702) accepts the identical `tsconfig.build.json` graph** and emits the
  same `.d.ts` — confirming the engine swap is a later drop-in, not a re-design.
- **Non-invasive:** adding `tsconfig.build.json` leaves the main `tsconfig.json` untouched, so
  `vp check`, Vitest, and the editor are unaffected (`vp check` on the package exited 0).

## Design

### The build-graph is separate from the editor/test config

`composite` forces declaration emit, but our packages run `noEmit` (vp/rolldown bundles them and emits
its own `.d.ts`). So references live in a **parallel `tsconfig.build.json` graph**, never on the main
`tsconfig.json`:

- **`tsconfig.build.json` per package/app** — the spike-validated template:
  ```jsonc
  {
    "extends": "./tsconfig.json",
    "compilerOptions": {
      "composite": true,
      "noEmit": false,
      "emitDeclarationOnly": true,
      "declaration": true,
      "declarationMap": false, // off — tsgo RC does not yet support declaration maps (keep tsc/tsgo parity)
      "outDir": ".tsbuild",
      "rootDir": "src",
      "tsBuildInfoFile": ".tsbuild/tsconfig.build.tsbuildinfo",
    },
    "references": [
      /* one { "path": "../<dep>/tsconfig.build.json" } per @magna-carta/* workspace dependency */
    ],
    "include": ["src/**/*.ts"], // src only — the public surface; test files are not in the build graph
  }
  ```
  `include` drops `test/**` deliberately: the reference graph type-checks the package's public surface
  and its cross-package contracts. Test type-checking stays with `vp check` on the main `tsconfig.json`.
- **Root `tsconfig.build.json`** — a solution file (`{ "files": [], "references": [ ...every package/app
build config... ] }`) so one `tsc -b` builds the whole graph in dependency order, incrementally.
- **`.gitignore`** gains `.tsbuild/` (the emitted `.d.ts` + `.tsbuildinfo` are regenerable build output).

### The type-check task

- Add **`vp run typecheck` = `tsc -b tsconfig.build.json`** (the root solution). Incremental across runs
  via the committed cache semantics of `.tsbuildinfo`.
- Root `check` script: `vp run typecheck` replaces the current whole-repo type-check; `vp check` keeps
  doing **only** fmt + lint (already fast). The api-client/web/rust legs are unchanged (web stays on
  `svelte-check`).
- Local inner loop: `tsc -b <package>/tsconfig.build.json` type-checks a package + its dependency
  closure incrementally; unchanged upstream projects are skipped.

### Rollout is generated, not hand-written

The 41 packages + TS apps each need a `tsconfig.build.json` whose `references` mirror their
`@magna-carta/*` workspace dependencies. Hand-authoring 41 and keeping them synced with `package.json`
drift is error-prone, so:

- A **generator** (`tooling/`) derives each `tsconfig.build.json`'s `references` from the package's
  `package.json` workspace deps (the same graph the audit script walked), and writes the root solution
  file. Re-running it is idempotent.
- A **fitness check** (CI + `vp check` fitness lane) re-runs the generator and fails if any
  `tsconfig.build.json` is out of sync with `package.json` — so a new workspace dependency cannot
  silently break the reference graph. This mirrors the existing source-scan fitness functions.
- **Precondition — acyclic graph (verified):** the audit found **0 circular dependencies** across 41
  packages; composite references cannot express a cycle, so the generator also asserts acyclicity (a
  guard that keeps the graph clean as packages are added).

### Scope of applicability

- **In the graph:** the 41 `@magna-carta/*` packages, `apps/worker`, `apps/scan-worker`.
- **Out (for now):** `apps/web` — its type-check is `svelte-check` (language-service based), which does
  not consume the reference graph and stays on the JavaScript compiler longest.

## Sequencing (this rollout vs. later)

1. **This rollout — references under JavaScript `tsc -b`** (mature build-mode orchestration).
2. **Later, separate change — `tsgo` cutover:** swap the `typecheck` task's engine to the native
   compiler at/after TS 7 GA, keeping a pinned JavaScript `typescript` for the Compiler-API tooling
   (openapi-ts, drizzle-kit, svelte-check — audited: our source imports the Compiler API nowhere, so
   the split is clean). Deferred because `tsgo`'s `-b` orchestration is still stabilizing at RC; our
   acyclic graph is the easy case, but the mature engine is taken first.
3. **Later — CI affected-graph:** run `tsc -b` for only the packages a change affects (plus dependents),
   sharding and persisting `.tsbuildinfo` between runs, now that references make "affected" precise.

## Risks & adaptations

- **`declarationMap` off** to preserve tsc/tsgo parity (tsgo RC lacks it) — cost is cross-package
  go-to-source in editors going to `.d.ts` rather than source; the editor already uses the main
  `tsconfig.json` (source), so this only affects the build graph, not the editing experience.
- **Emitted `.d.ts` is throwaway** (rolldown emits the shipped declarations); the build graph emits its
  own only because `composite` requires it. `.tsbuild/` is gitignored and cleaned by the existing
  post-merge sweep alongside other build output.
- **Two configs per package** is the accepted cost of keeping the editor/test config (`noEmit`,
  includes tests) separate from the build/reference config (emit, src-only). The generator keeps the
  build configs correct so the second file is not a maintenance burden.

## Decision record

Adopting project references (and the deferred `tsgo` cutover) is an architecture decision → an ADR
fragment (`docs/decisions/pending/typescript-project-references.md`) accompanies the implementation.

## Landing status (2026-06-30)

The full-graph build (`tsc -b tsconfig.build.json`) surfaced a discovery: **35 of 37 members type-check
clean under composite, but the whole graph reports 16 errors — and at least some are real, pre-existing
type errors that the current `vp check` type-check does not catch.** Confirmed: `file-manager`'s own
plain `tsc --noEmit -p packages/file-manager/tsconfig.json` reports its error in ~10s, so it is real,
not induced by composite/references. A plausible cause of the gap: the whole-repo check is slow enough
(`apps/worker` alone exceeded 3 minutes) that it is not being run to completion, so latent errors
accumulate. **The incremental type-check would not just be faster — it would catch more.**

Because fixing these errors touches `apps/worker`, `packages/pdf`, and `packages/file-manager` — shared
files in flight on other branches — and one is a domain question (whether `scanVerdict: "infected"`
belongs in `CleanVersion`, or is an upstream bug), the fixes are **deferred to a follow-up** rather
than bundled here. This keeps the landing non-disruptive.

**What landed (non-gating):** the generator (`tooling/tsconfig-refs/`), the 38 generated
`tsconfig.build.json` (+ root solution), the `typescript` catalog pin + root devDep, `.gitignore`
(`.tsbuild/`), and the `vp run typecheck` / `vp run typecheck-refs` tasks. **None is wired into the
`pnpm check` gate**, so every branch's gate behaves exactly as before — the new files, the devDep, and
the available tasks are inert until the gate is turned on.

**The error inventory (the fix-forward work):**

- `packages/file-manager/src/queries.ts:177` — TS2322: a value with `scanVerdict: "infected"` assigned
  to `CleanVersion` (whose `scanVerdict` excludes it). **Real** (confirmed under plain `noEmit`). Needs
  a domain call: widen `CleanVersion`, or fix the producer.
- `apps/worker/src/routes/timekeeping/time-entries.ts:603,904,975,1057` — TS2345: `ProxyBatchDatabase` passed where
  `D1Database` is expected (missing `exec`/`withSession`/`dump`). Real-class assignability errors.
- `apps/worker/src/routes/files/file-type.ts:88` — TS2345 (`readonly string[]` → mutable `string[]`);
  `:114,129` — TS2820: `"engine-unavailable"` is not a member of the Problem `type` union
  (`"service-unavailable"`?).
- `apps/worker/src/app.ts:527` — TS2883: `buildOpenAPIDocument`'s inferred type is not nameable in the
  emitted declaration; needs an explicit return-type annotation. **Emit-specific** (only under the build
  graph's declaration emit).
- `packages/pdf/src/index.ts` (×6) — `WebAssembly` / `BufferSource` unresolved: pdf's `lib` is
  `["ES2022"]` + `types: ["node"]`, missing the lib that declares them (also requires the wasm artifact
  built). A tsconfig `lib` fix.

**Go-green steps (the follow-up):** fix the inventory above → confirm `tsc -b tsconfig.build.json` is
clean → wire `vp run typecheck` and the sync check (`node tooling/tsconfig-refs/index.mjs --check`) into
the root `check` script (and consider dropping vp check's own `typeCheck` to avoid a double type-pass,
after confirming type-aware lint coverage is preserved). Coordinate the shared-file fixes via
`vp run worktrees`.

**Independent finding (investigated):** the whole-repo `vp check` type-check does not complete in a
practical time (timed out at 10 minutes with no output), so real type errors sit on `main` unenforced —
`vp check` catches them when scoped, so this is performance-induced, not a linter-capability gap. The
incremental gate is the fix. Full evidence + recommendation:
[`docs/research/vp-check-typecheck-coverage-gap.md`](../research/vp-check-typecheck-coverage-gap.md).

## Coordination with concurrent branches

A rollout that adds a config to every package meets every in-flight worktree at merge time. The design
is deliberately shaped to make that alignment **mechanical, not manual**, and enforced rather than
remembered.

**Why the conflict surface is small:**

- The per-package `tsconfig.build.json` files and the root solution file are **generated from
  `package.json` workspace deps** — the source of truth each branch already edits. They are treated
  like other generated/assembled artifacts (the `changelog.d/` + `docs/decisions/pending/` precedent):
  **never hand-edited on a branch.** A branch that adds a package, or changes a package's
  `@magna-carta/*` dependencies, does not edit any build config — it re-runs the generator, which
  rewrites them deterministically. Two branches regenerating produce identical output, so there is no
  semantic merge conflict to resolve.
- Almost all touched files are **new** (`tooling/` generator, 41 + 2 `tsconfig.build.json`, root
  solution) — new files do not conflict with existing branch edits. The only shared edits are small and
  append-friendly: `.gitignore` (`+.tsbuild/`) and the root `package.json` `check`/`typecheck` scripts.

**The enforcement that makes it safe:** the sync **fitness check** (CI + `vp check` lane) re-runs the
generator and fails if any `tsconfig.build.json` is stale versus `package.json`. So a branch that added
a package or a dependency and forgot to regenerate **fails its own PR check** with a clear fix (run the
generator) — the graph can never silently drift out of alignment. "Did you align with the references
rollout?" becomes an automatic, per-PR answer, not a manual audit.

**Rollout logistics:**

1. **Announce before landing.** This is a repo-wide cross-cutting change — post it in the build-perf
   active-work note, and check `vp run worktrees` for overlap and drift before merging (golden rule for
   cross-cutting files).
2. **Land as one focused change** (generator + all generated configs + `.gitignore` + the `typecheck`
   task + the fitness check), so a branch syncing `main` picks up the whole rollout in one merge, not a
   half-applied graph.
3. **In-flight branches align on their next `main` sync:** merge `main`, run the generator (or let it
   run in `vp install` / the fitness lane), commit the regenerated configs. For a branch that added no
   package and changed no workspace dep, the generator is a no-op and the only carried change is the
   new-file graph merging in cleanly.
4. **Prefer to land when drift is manageable.** Several branches are far behind `main`; the
   generated-not-hand-authored design keeps their per-branch cost low regardless, but landing sooner
   (less total drift to absorb) is cheaper than later.

## Out of scope

The `tsgo` cutover, the CI affected-graph, and any `svelte-check`/web type-check acceleration are named
follow-ons, not part of this rollout.
