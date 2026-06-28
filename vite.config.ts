import { defineConfig } from "vite-plus";

export default defineConfig({
  // Formatter (Oxfmt), made explicit so a beta-tool default change can't silently reflow our code or prose.
  // printWidth and proseWrap already match Oxfmt's defaults (100 and "preserve"); endOfLine pins LF to match .gitattributes and .editorconfig.
  // Prose is never hand-wrapped (proseWrap: "preserve"); code wraps at printWidth. See conventions/code-style.md and documentation-style.md.
  fmt: {
    printWidth: 100,
    proseWrap: "preserve",
    endOfLine: "lf",
    // Generated artifacts whose exact bytes are fixed by their generator and re-derived/diff-gated by
    // CI (code-as-contract): the OpenAPI snapshot (apps/worker/scripts/emit-openapi.mts) and the Hey
    // API client (packages/api-client/openapi-ts.config.mjs). Never hand-edit them, and never let the
    // formatter reflow them out from under the generate/diff contract. docs/decisions/** is the same
    // case: per-ADR files are assembled by tooling/doc-fragments/build-decisions.mjs with authored
    // bodies passed through verbatim, so formatter reflow would fight the assembler.
    ignorePatterns: [
      "apps/worker/openapi/openapi.json",
      "packages/api-client/src/**",
      "docs/decisions/**",
    ],
  },
  // typeCheck makes `vp check` run tsgolint TS type-checks (not just fmt+lint); a real `.ts` type error now fails the gate.
  // tsgolint does not parse `.svelte`, so the full gate (`pnpm check`) also runs svelte-check. See conventions/typescript.md.
  lint: {
    // The Hey API generated client is not our code to lint (its barrel index and codegen idioms trip
    // our rules); exclude it. NOTE: vp's type-check runs through this lint pass, so excluding the
    // generated client here also drops it from tsgolint — so the "generated client compiles" gate is
    // provided separately by the api-client `typecheck` script (a dedicated `tsc -p`, wired into the
    // root `check`), which type-checks every generated file. The OpenAPI snapshot is data, not source.
    ignorePatterns: ["packages/api-client/src/**"],
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  // Per-package test projects. apps/worker runs its tests inside Miniflare via @cloudflare/vitest-pool-workers, which only activates when its own config (apps/worker/vitest.config.ts) is loaded, so it is registered as a Vitest project here; otherwise root `vp test` would run the worker test under the default pool and `cloudflare:test` would not resolve.
  test: {
    projects: [
      "apps/worker/vitest.config.ts",
      "packages/*/vitest.config.ts",
      "tooling/doc-fragments/vitest.config.ts",
      "tooling/worktrees/vitest.config.ts",
      "tooling/clean/vitest.config.ts",
    ],
  },
  // vp reads test/lint/format defaults from here; run.tasks declares the monorepo graph.
  // Task keys are plain task names with a `command`; the `package#task` form is only valid inside `dependsOn` (see viteplus.dev/config/run).
  run: {
    tasks: {
      // Build the `magna-carta` app worker's deploy artefacts in dependency order: the wasm, then the
      // SPA (which bundles it), then the worker that serves apps/web/build. This is the Workers Build
      // command for `magna-carta` (operations.md §12), so it is deliberately SCOPED to the app worker —
      // it does NOT build the standalone sibling workers (scan/bundle/convert/edit). Those are separate
      // deployables with their own Workers Builds; building their container images here is both wasteful
      // and fragile (e.g. the scan image's YARA Forge download is rate-limited, which would fail the app
      // deploy on an unrelated worker). `dependsOn` forces the wasm + the SPA before the worker's build.
      "build-all": {
        command: 'vp run --filter "@magna-carta/worker" build',
        dependsOn: ["@magna-carta/web#build", "rust-wasm-build"],
      },
      // Rust quality gate: fmt + clippy + unit tests for the crates/ workspace.
      // Run via `vp run rust-check`; also wired into the root `check` script so `pnpm check` covers Rust.
      // --all is required for cargo fmt to discover targets when --manifest-path points at a workspace root.
      "rust-check": {
        command:
          "cargo fmt --manifest-path crates/Cargo.toml --all --check && cargo clippy --manifest-path crates/Cargo.toml --all-targets -- -D warnings && cargo test --manifest-path crates/Cargo.toml",
      },
      // Build the pdf-core WASM artefact into packages/pdf/src/pkg — IN A PINNED RUST DOCKER IMAGE
      // (crates/pdf-core/wasm.Dockerfile, mirroring containers/scan/Dockerfile), never on the host
      // toolchain. This is the one canonical wasm build, invoked identically in local builds and in
      // Cloudflare Workers Builds: the build environment needs only Docker (which the Workers Builds
      // runner provides — the same way the scan/bundle/convert container images build), never Rust or
      // wasm-pack on the bare machine. `--output type=local` exports exactly the wasm-pack output to
      // the host package dir (the import path packages/pdf/src/index.ts expects). Build context is
      // crates/. Like the container workers, this requires Docker available locally.
      // --network=host: the Workers Builds runner's Docker isolates RUN-step networking (image pulls
      // work, but RUN-step DNS fails), so the rustup/cargo downloads need the host network — which the
      // bare runner has (it clones the repo + runs pnpm install). Harmless locally.
      "rust-wasm-build": {
        command:
          "docker build --network=host --output type=local,dest=packages/pdf/src/pkg -f crates/pdf-core/wasm.Dockerfile crates",
      },
      // The worker serves apps/web/build, so its build and dev both depend on the SPA build (cross-package package#task notation).
      // Named worker-build / worker-dev (not build / dev) so they do not collide with the root package.json build / dev scripts.
      "worker-build": {
        command: 'vp run --filter "@magna-carta/worker" build',
        dependsOn: ["@magna-carta/web#build"],
      },
      "worker-dev": {
        command: 'vp run --filter "@magna-carta/worker" dev',
        dependsOn: ["@magna-carta/web#build"],
      },
      // Assemble doc fragments on main after a merge (see docs/conventions/documentation.md):
      // number + fold pending ADRs into per-file decisions and regenerate the register.
      "decisions-build": {
        command: "node tooling/doc-fragments/build-decisions.mjs",
      },
      // Fold changelog.d/* fragments into CHANGELOG.md [Unreleased] and consume them.
      "changelog-build": {
        command: "node tooling/doc-fragments/build-changelog.mjs",
      },
      // Print the active-work registry: git worktrees + docs/active-work notes + touch-overlaps.
      // Run before starting a stream or editing a cross-cutting file (see docs/active-work/README.md).
      worktrees: {
        command: "node tooling/worktrees/index.mjs",
      },
      // Reclaim regenerable build artifacts from merged worktrees + dangling Docker cache. Runs
      // automatically from the post-merge hook (tooling/git-hooks/post-merge); also runnable by
      // hand. Pass flags to the script directly for a preview: node tooling/clean/index.mjs --dry-run
      clean: {
        command: "node tooling/clean/index.mjs",
      },
      // One-time per clone: point git at the tracked hooks directory so the post-merge auto-clean
      // is active. Idempotent.
      "setup-hooks": {
        command: "git config core.hooksPath tooling/git-hooks",
      },
    },
  },
});
