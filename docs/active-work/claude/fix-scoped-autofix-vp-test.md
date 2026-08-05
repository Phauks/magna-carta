---
branch: claude/fix-scoped-autofix-vp-test
worktree: C:/dev/magna-carta-worktrees/claude/fix-scoped-autofix-vp-test
area: inner-loop tooling — make `pnpm fix:scoped` autofix safe, and make a concurrent `vp test` fail fast
status: building
touches: tooling/check-scoped/, tooling/test-single-flight/, package.json, vite.config.ts, docs/conventions/build-performance.md, changelog.d/
---

Two confirmed inner-loop hazards, both in tooling only — no product code.

The fixer (`pnpm fix:scoped`) applied every lint autofix the linter offered, including two whose
rewrites are wrong here: `unicorn/no-array-sort` turns `.sort()` into `.toSorted()` in packages
whose `lib` is `ES2022` (type errors), and `typescript/no-unnecessary-boolean-literal-compare`
rewrites explicit `=== false` comparisons in access-control guards. Both now stay warnings in check
mode and are excluded from the fix pass. Second, two concurrent test runs in one worktree wedge each
other, so the test entry point takes a single-flight lock and a second run fails fast.

Touches `docs/conventions/build-performance.md` (inner-loop section) and adds one entry to the
`test.projects` list in `vite.config.ts` — coordinate if another stream is editing either.
