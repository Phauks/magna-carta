---
branch: claude/test-typecheck
worktree: .claude/worktrees/test-typecheck
area: Give the typecheck of record a second, non-emitting test project per package, so the 837 test files it has never looked at are type-checked — and burn down the backlog that surfaces.
status: in review
touches: tooling/tsconfig-refs/index.mjs, tsconfig.test.json, packages/*/tsconfig.test.json, apps/*/tsconfig.test.json, vite.config.ts, docs/conventions/build-performance.md, docs/conventions/typescript.md, changelog.d/, docs/decisions/pending/, docs/active-work/, and the test files the burn-down touches
---

The gap named in `docs/conventions/build-performance.md` — the reference graph is src-only, so
`vp run typecheck` covers 1,078 source files and none of the 837 test files beside them — closed
rather than documented.

- **The mechanism is a generated second project per member.** `tooling/tsconfig-refs/index.mjs` now
  emits a `tsconfig.test.json` alongside each `tsconfig.build.json`: `composite` (a solution file can
  only reference composite projects) and `noEmit` (nothing consumes a test), which is what frees it
  from the `rootDir: "src"` the build project needs for declaration emit. Its `include` is derived —
  the package's own `include` minus `src/**` and minus `.svelte` — so the two generated projects
  together cover exactly what the package's own `tsconfig.json` declares. It references the package's
  own build project first, so imports resolve to declarations `tsc -b` has already built.
- **A root `tsconfig.test.json` solution** references every member's test project, and
  `vp run typecheck` builds both roots. Both remain diff-gated by
  `node tooling/tsconfig-refs/index.mjs --check`.
- **No error is silenced.** No `any`, no `@ts-expect-error`, no production type widened to make a
  test compile. The 53 errors this surfaced across 16 of the 70 in-solution members are fixed at the
  seam each names.
- **`apps/worker` is deferred, with both reasons measured.** One of its test files does not
  type-check in 600 seconds on its own, and the other 234 report 156 errors. It keeps its generated
  test project and stays checkable on demand; the deferral is a named entry in the generator, not a
  silent omission.

Cross-cutting files touched: `vite.config.ts` (the `typecheck` task's command only),
`docs/conventions/build-performance.md`, `docs/conventions/typescript.md`. The generated
`tsconfig.*.json` files are regenerable, so a conflict in them is resolved by re-running the
generator, never by hand.
