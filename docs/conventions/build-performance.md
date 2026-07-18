# Build-time performance conventions

**Status:** Active (the playbook and the "apply it when you add something that builds" discipline apply now; concrete build-time budgets/metrics land later).

**Scope (single home for):** keeping **build time** fast — the developer feedback loop and everything that builds repeatedly in the cloud (Worker bundles, the SvelteKit SPA, Container images, Rust crates, generated artifacts). This is about how fast the build _runs_, not how fast the product runs at request time — that is runtime performance, which lives in [`performance.md`](performance.md) and golden rule 10.

**The build/deploy pipeline is Cloudflare Workers Builds**, not GitHub Actions — it builds and deploys each Worker on push to its **production branch, which is `release`, not `main`** (a push or merge to `main` builds nothing; a deploy is a deliberate `git push origin main:release`). The operator runbook (connect repo, build/deploy commands, branch control, enabling the settings below) lives in [`operations.md`](operations.md); this file is the principles and the why.

**Why this is a foundation, not a measure-first optimization.** Build caching and fast build steps are the canonical _cheap-from-the-getgo, expensive-to-retrofit_ work: you add them up front because fast feedback compounds across every push and every contributor. This sits under the **"Build when in the area"** principle (root [`CLAUDE.md`](../../CLAUDE.md), _How we work_; ADR-0078), **not** under golden rule 10's measure-first gate — you do not wait for a profile to justify a cache. The distinction is deliberate: golden rule 10 governs runtime optimization (optimize against evidence); this file governs build foundations (add them by default).

**Distinct from disk hygiene.** Reclaiming dead build output so the disk does not fill is a separate concern, handled automatically by the post-merge `vp run clean` sweep (the auto-clean decision in the [Decision Log](../Decision-Log.md)). That deletes regenerable artifacts; this file is about making the builds that produce them fast.

## The default: anything that builds repeatedly is optimized for fast builds

When you add or change anything that builds in the cloud — a new Worker, a Container image, a code-generation step — make it fast by default. The standing techniques, in rough order of leverage:

### Use Workers Builds' native caching and path scoping

Workers Builds is the build surface, so its own settings are the first lever (configured per Worker in the dashboard — see [`operations.md`](operations.md)):

- **Build Caching — on.** Caches dependencies and build outputs across builds in a project-wide cache, so a build does not re-download the pnpm store or rebuild unchanged outputs every time. This is the cloud-build analog of a CI dependency cache and the single biggest win.
- **Build Watch Paths — scoped per Worker.** In a monorepo, scope each Worker to the paths it actually depends on so an unrelated change does not trigger a full rebuild of every Worker (e.g. `magna-carta-scan` watches `containers/scan/**` and its package; `magna-carta` watches the worker/web/shared paths and excludes `containers/**`). This is "build only what changed" at the pipeline level.

Caching only helps if inputs are stable, so **commit lockfiles** (`pnpm-lock.yaml`, `Cargo.lock`) and pin versions, and install with `--frozen-lockfile` — a moving input is a permanent cache miss.

### Cache the heavy compiles inside a build

For work the build itself repeats — chiefly native compiles — cache within the build so an unchanged dependency graph is not rebuilt:

- **Rust / Docker** — build the Container image with BuildKit cache mounts (`--mount=type=cache`) on `/usr/local/cargo` and the crate `target/` so dependency compiles are reused. A cache mount is not part of an image layer, so copy the built binary out to a non-mounted path in the same `RUN` before the stage ends (see `containers/scan/Dockerfile`).
- **Order Dockerfiles slow-changing-first** — system packages, then dependency manifests, then source — so an unrelated source edit does not invalidate the heavy layers.

Note: BuildKit cache mounts are build-local. Persisting them across Workers Builds runs (a cache-mount export) is the documented upgrade path if cold dependency compiles become the bottleneck — not done up front.

### Trim the work the build has to do

- **Multi-stage Docker builds** — keep the toolchain in a build stage; ship a slim runtime image with no compiler, intermediates, or caches.
- **Lean build context** — a `.dockerignore` that excludes `target/`, `node_modules/`, and other heavy regenerables keeps context transfer small.
- **Minimal feature/dependency sets** — compile only what the artifact needs (e.g. default-off optional native backends, trimmed crate features) so the build pulls and compiles less.
- **Respect the dependency graph; never build an artifact twice** — `vp run build-all` builds the SPA once and orders the Worker after it through the vp task graph; do not add steps that rebuild the same output.

### Move slow inputs to build time, not run time

Work that would otherwise happen on every cold start belongs in the image, fetched and pre-processed once at build time: baked databases, compiled/serialized rule blobs, prebuilt indexes. The scan Container is the worked example — it bakes the ClamAV signature DB and a compiled YARA-rule blob at build time, so the runtime container neither downloads nor recompiles them. This trades a slightly longer build for a fast, network-free start; prefer it whenever a runtime input is large and slow-changing.

## Type-checking and static analysis — the local feedback loop

The other half of "build time fast" is the **static-check loop** every contributor runs constantly:
`vp check` (format + lint + type-check) and the per-package `tsc --noEmit` / `svelte-check` passes.
Its cost profile is uneven, and knowing where the cost is prevents optimizing the wrong thing:

- **Format (`oxfmt`) and lint (`oxlint` + the `tsgolint` type-aware path) are already Rust-native and
  fast** — whole-repo formatting checks finish in seconds. They are not the bottleneck and need no
  structural work; keep them enforced (below) rather than sped up.
- **Full TypeScript type-checking (`tsc`) is the cost center.** It runs over the whole program with no
  incrementality, so its wall-clock scales with _total_ code, not _changed_ code — the one part of the
  loop that gets worse as the monorepo grows. A scoped type-check of a few files is seconds; a cold
  whole-repo type-check is minutes.

The techniques, in leverage order:

### Scope the check to what changed (now)

**The full gate (`pnpm check`)** runs `vp check` (fmt + lint) and **`vp run typecheck` (`tsc -b`) as the
authoritative type-check** — `tsc -b` is fast and incremental, so the type pass actually completes and
real errors can no longer slip (`vp check`'s own whole-repo type-error pass is off; `typeCheck: false`).
It is exhaustive and slow by design, and it is the **gate of record — run in GitHub Actions**
(`.github/workflows/gate.yml`, alongside the full `vp test`) on every pull request and push to `main`,
not on the inner loop.

**The fast local loop — and the pre-push hook — is `pnpm check:scoped`** (`tooling/check-scoped/`). It
derives the change set from the git diff (merge-base with `main`, plus the working tree) and runs only
what that change can break: fmt + lint on the changed paths, the incremental `tsc -b` type-check, and
`svelte-check` or the Rust gate **only when a `.svelte` file or a crate was actually touched**. It prints
what it skipped and why — a gate that quietly checks nothing is worse than a slow one.

The distinction matters because the full gate's cost is nearly all fixed: seven serial whole-repo passes
run identically whether the diff is three files or three hundred, and in practice the overwhelming
majority of those runs re-confirm what was already true. Scope the local loop; keep the whole-repo sweep
in CI, where it gates the merge into `main`.

### Bootstrap the generated artefacts (a fresh worktree is not a runnable worktree)

`packages/{pdf,decryption,email}/src/pkg/` is **generated** wasm-bindgen output and **git-ignored**, so a
newly created worktree has none of it and every type-check or test touching those packages fails on an
unresolvable import until somebody rebuilds it. That is a bootstrap gap, not a per-change cost, and it
is paid once per worktree — of which several are live at any time.

**`vp run bootstrap`** (`tooling/bootstrap/`) closes it: it rebuilds only the artefacts whose Rust inputs
are newer than the `.wasm` they produced, and is a sub-second no-op when everything is current, so it is
safe to run at the top of any session. `pnpm check:scoped` calls it in `--check` mode and fails fast with
the fix, rather than surfacing the gap as a confusing type error.

It also writes a **git-ignored `crates/.cargo/config.toml`** pointing cargo at a target directory shared
by every worktree on the machine (`~/.cache/magna-carta/cargo-target`). Cargo's `target/` is otherwise
per-worktree, so each new worktree pays a full cold dependency compile for the same unchanged crate
graph. Sharing makes the second worktree's build a cache hit; concurrent builds serialize on cargo's own
file lock, which is also the behaviour a 16 GB box wants. `MAGNA_CARTA_SHARED_CARGO_TARGET=0` opts out.

`vp run rust-wasm-build` (Docker, pinned toolchain) remains the **canonical** wasm build — it is what the
deploy pipeline runs, and it needs no host Rust. `vp run bootstrap` is the local fast path over the same
wasm-pack invocation; `--docker` forces the canonical images.

### TypeScript project references + incremental (the structural scaler)

Make each package a `composite` project that `references` its workspace dependencies, with
`incremental` + a `tsBuildInfoFile`. Then `tsc -b` (build mode) re-checks only changed projects and
their dependents and reads the rest from `.tsbuildinfo`; a package whose _public API_ is unchanged is
not re-checked downstream at all. Check time then scales with **changed** code — the durable fix for a
growing monorepo. The prerequisite is an **acyclic** package graph (composite references cannot express
a cycle); the workspace is acyclic today (a source-scan/graph check keeps it so), which is what makes
this a mechanical rollout rather than an untangling. The build order falls out of the existing
dependency graph.

### The native compiler (TypeScript 7 / `tsgo`) — after references

The Go-native TypeScript compiler (shipping as TypeScript 7; `tsgo`) type-checks roughly **10× faster**
than the JavaScript `tsc`, from native execution plus worker-thread parallelism, and supports
`--incremental`, project references, and `-b` — so it **compounds with** the references work rather than
replacing it. Two rules govern adopting it:

- **References first, native second.** Land project references under the current (JavaScript) `tsc -b`,
  which is mature, then swap the engine to `tsgo`. `tsgo`'s `-b` orchestration of complex composite
  graphs is still stabilizing as of its RC; sequencing this way isolates the change to one variable at
  a time (our acyclic graph is the easy case, but the mature path is still taken first).
- **Keep the JavaScript compiler for Compiler-API tooling until the new API lands.** `tsgo` does not
  expose the JavaScript `typescript` Compiler API (a replacement arrives in a later 7.x). Tools that
  consume it — here, OpenAPI client generation, the database migration tool, and `svelte-check` for the
  SPA — keep a pinned JavaScript `typescript` while `tsgo` becomes the _type-checker_ for the packages
  and the Worker. Our source imports the Compiler API nowhere, so this split is clean; the SPA's
  `svelte-check` stays on the JavaScript compiler longest.

### Keep the fast checks trustworthy

Speed is worthless if the check is ignored. Format and lint must be **enforced in the pipeline** so the
tree never drifts — a repo full of format-drifted files trains everyone to skip the check and hides
real failures behind noise. Commit to the enforced formatter/linter versions (a version skew reformats
files that were already correct); pin them like any other build input.

## When you add something that builds, check

- Is Build Caching on for the Worker, and are Build Watch Paths scoped so it only rebuilds when its inputs change?
- Are lockfiles committed and versions pinned (with `--frozen-lockfile`), so the cache actually hits?
- For a Container: multi-stage, lean `.dockerignore`, slow-changing layers first, cache mounts on dependency dirs (binaries copied out)?
- Is any large slow-changing runtime input baked at build time instead of fetched on start?

## To formalize (later)

- Build-time budgets and a signal that flags a regression in build wall-clock, once there is a baseline worth holding.
- Persisting BuildKit **cache mounts** across Workers Builds runs (the registry/`target` mounts are build-local today) if cold Rust dependency compiles in the Container build become the bottleneck.
- **`tsgo` cutover** — swap the type-check engine to the TypeScript 7 native compiler once references have landed and it reaches GA, keeping a pinned JavaScript `typescript` for the Compiler-API tooling.
- **Extend the CI affected-graph to type-check** — the CI `lint` job lints only the affected packages (below) and the `test` job is now sharded (below); the `typecheck` job still runs whole-repo. Persisting its `.tsbuildinfo` across runs so `tsc -b` is incremental in CI is the remaining affected-graph work.

### Scope the CI type-aware lint to the affected packages (now)

The whole-repo type-aware lint (`vp check --no-fmt`, oxlint + tsgolint) is CI's tall pole — ~24 min, single-threaded, no cross-run cache upstream. But tsgolint builds its type program **lazily from the passed files' import closure**, so `vp check --no-fmt <paths>` scopes the cost to those paths: one small package is ~2 s where the whole repo is ~24 min (measured). The earlier belief that this "depends on a vp mechanism to scope `typeAware`" was wrong — the `vp check [PATHS]` passthrough already is that mechanism, and cross-package types still resolve from the closure.

So the gate's **`lint` job lints only the affected packages**, computed by `tooling/affected-lint`: the changed workspace packages **plus their transitive dependents** — never just the changed files, because a type-aware finding in an unchanged file can flip when a dependency changes (that soundness gap is exactly why `check-scoped`, which lints only changed files, is fine for the local loop but not the gate of record). A change to a global input — the lint ruleset and the shared compiler options (`vite.config.ts` — which is both the lint ruleset home and where `typeAware` lives — plus `tsconfig.base.json`, `packages/tsconfig/`), the lockfile, `.github/`, or the affected-lint logic itself — falls back to a whole-repo lint, as does any lintable source file outside every package. Only the lint job is scoped this way; type-check, tests, and the contract checks still run whole-repo, so the blast radius of a scoping miss is one type-aware lint rule, not correctness at large. A typical few-package change drops the tall pole from ~24 min to seconds; a foundational package (e.g. `@magna-carta/identifiers`) correctly re-lints its whole dependent set.

### Shard the CI test suite across parallel runners (now)

The tests are deliberately **not** affected-scoped — a change in a foundational package can break a consumer's test that a dependency-graph scope would miss, and a missed test failure is a correctness hole, not (as with lint) one type-aware rule. So instead of _scoping_ the tests, the gate _shards_ them, and it shards along the suite's **natural project boundaries** rather than one blind shard over everything. The suite has three substrates with very different per-file cost and setup — plain node units (milliseconds), the Miniflare Workers pool (a Workers runtime per file), and the design-system Storybook stories (Chromium via Playwright) — so the `test` job is split into three:

- **`test-node`** — `packages` + `apps/web` + the standalone sibling workers (`apps/bundle-worker`, `apps/convert-worker`, `apps/file-repair-worker`, `apps/magna-carta-edit`, `apps/ocr-worker`, `apps/recovery-worker`, `apps/scan-worker` — default-pool unit tests with faked bindings) + `tooling`, with the `storybook` project excluded (`--project='!storybook'`), sharded within the job. No Miniflare, no browser: the bulk of the tests, cheapest per file.
- **`test-worker`** — the files under `apps/worker` + `apps/status-worker`, sharded within the job. The heaviest substrate (a Workers runtime per file), on its own so it scales independently.
- **`test-stories`** — the `storybook` project, one runner. The **only** browser suite, so it is the **only** job that installs Chromium — the split's biggest win over a blind shard, which paid the Playwright install on every shard.

Each job shards by file count (`--shard=i/N` over its scope; `SHARD_TOTAL` + the matrix list per job). **Completeness is by construction:** the three jobs partition every **registered** test file exactly once — `storybook` is the only project that spans a path root (it lives under `packages/design-system`), so it is the only one included-by-name in one job and excluded-by-name from another; every other file belongs to exactly one path root. Adding a new test area is **two registrations**: its vitest config into the root `vite.config.ts` `test.projects` list, **and** its path into `test-node` (or a new job). The path half fails loud when mis-scoped (vitest's `passWithNoTests` is left off — a path that matches nothing errors); the registry half is the one nothing catches automatically — `test.projects` is a closed list, and an unregistered project's tests run **nowhere** (root `vp test` and CI both walk only registered projects), so treat the registry as part of the partition. Wall-clock is now paced by the heaviest substrate rather than a random file draw; if `test-worker` becomes the pole, raise its shard count alone.
