---
worktree: /home/user/magna-carta/.claude/worktrees/tooling-friction
area: three developer-tooling defects — zero-match test filters, WASM-artefact gate scoping, load-profile temp reaping
status: review
touches: tooling/test-single-flight, tooling/check-scoped, tooling/clean, packages/fixtures/src/load-profile, docs/conventions/build-performance.md, changelog.d
---

# claude/tooling-friction

Three independent defects, batched under one owner because they all live in `tooling/` and
`packages/fixtures`:

1. **`pnpm test <directory>` that matches no file exits 0 and claims the directory is empty.** Each
   `tooling/*` vitest project roots at its own directory, so a bare `tooling` path filter matches
   nothing in any project and the runner reports "No test files found" — the same silent-narrowing
   shape as a truncated gate path list. Fixed in `tooling/test-single-flight/`.
2. **`check:scoped` demands the WASM artefacts for diffs that reach no WASM consumer.** The gate
   already scopes svelte-check, the Rust gate, drizzle snapshots and the fitness sweep to the diff;
   the artefact precondition should skip on the same basis, conservatively (transitive reachability,
   not a filename guess). Fixed in `tooling/check-scoped/`.
3. **Nothing reaps the load-profile snapshotter's `mkdtemp` working directories.** They accumulated
   to ~8 GB and filled the disk. The creator now removes its own directory on success and on
   failure; `vp run clean` gains an age-bounded sweep of that one prefix as a backstop for killed
   runs.

**Not touched:** `packages/billing` and `packages/database` (another stream owns those). No
production code — `tooling/`, the `packages/fixtures` load-profile snapshotter, and their docs only.
