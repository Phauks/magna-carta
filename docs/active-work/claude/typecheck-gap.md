---
branch: claude/typecheck-gap
worktree: .claude/worktrees/typecheck-gap
area: The typecheck of record is src-only — the whole test corpus is outside it. Three notifications test errors fixed; the systemic gap measured and reported.
status: building
touches: packages/notifications/test/read-bounds.test.ts, packages/notifications/test/delivery-end-to-end.test.ts, docs/conventions/build-performance.md, changelog.d/, docs/active-work/
---

A filed claim — that `tsc -b packages/notifications` reports three `bindings` errors that
`tsc -b tsconfig.build.json` never sees — verified on a clean `origin/main`, then fixed, with the
systemic finding behind it measured rather than silently widened.

- **The three errors are real** and reproduce on a clean checkout at `04a49fc9`. Both test files ask
  a builder-returned `SqlStatement` for the node-sqlite-only `bindings` property. Fixed with the
  narrowing helper the codebase already uses five times over in
  `packages/fixtures/src/load-profile/*-measurements.ts`, not with a type change.
- **The graph genuinely excludes them, and this is repo-wide, not package-specific.** Every member's
  generated `tsconfig.build.json` sets `include: ["src/**/*.ts"]`, so no package's `test/` directory
  is in the typecheck of record. `tooling/tsconfig-refs/index.mjs` says tests "stay with `vp check`",
  and `vite.config.ts` sets `lint.options.typeCheck: false` — so nothing type-checks them.
- **Widening the graph is NOT done here.** The member configs are `composite` + `emitDeclarationOnly`
  with `rootDir: "src"`, so test files cannot simply join `include`; closing this needs its own
  per-package non-emitting test project, and it surfaces a backlog. Numbers are in the changelog
  fragment and the pull request; the correction to what the gate actually covers is in
  `docs/conventions/build-performance.md`.

No source behaviour changes. Test files and one convention paragraph only.
