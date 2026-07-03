# Build-time performance conventions

**Status:** Active (the playbook and the "apply it when you add something that builds" discipline apply now; concrete build-time budgets/metrics land later).

**Scope (single home for):** keeping **build time** fast — the developer feedback loop and everything that builds repeatedly in the cloud (Worker bundles, the SvelteKit SPA, Container images, Rust crates, generated artifacts). This is about how fast the build _runs_, not how fast the product runs at request time — that is runtime performance, which lives in [`performance.md`](performance.md) and golden rule 10.

**The build/deploy pipeline is Cloudflare Workers Builds**, not GitHub Actions — it builds and deploys each Worker on push. The operator runbook (connect repo, build/deploy commands, enabling the settings below) lives in [`operations.md`](operations.md); this file is the principles and the why.

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

## When you add something that builds, check

- Is Build Caching on for the Worker, and are Build Watch Paths scoped so it only rebuilds when its inputs change?
- Are lockfiles committed and versions pinned (with `--frozen-lockfile`), so the cache actually hits?
- For a Container: multi-stage, lean `.dockerignore`, slow-changing layers first, cache mounts on dependency dirs (binaries copied out)?
- Is any large slow-changing runtime input baked at build time instead of fetched on start?

## To formalize (later)

- Build-time budgets and a signal that flags a regression in build wall-clock, once there is a baseline worth holding.
- Persisting BuildKit **cache mounts** across Workers Builds runs (the registry/`target` mounts are build-local today) if cold Rust dependency compiles in the Container build become the bottleneck.
