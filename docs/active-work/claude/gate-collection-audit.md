---
branch: claude/gate-collection-audit
worktree: .claude/worktrees/agent-ab20b90d09b6af8c6
area: CI gate integrity — the test jobs' positional path filters were collecting a fraction of the suite
status: building
touches: .github/workflows/gate.yml, tooling/lint-test-collection.mjs, package.json, docs/conventions/build-performance.md, changelog.d/gate-collection-floor.md
---

The gate's `test-node` job filtered the runner with the relative paths `packages` and `tooling`. Both
are the _parent_ of many project roots, and the runner matches a positional filter per project against
the candidate file's path relative to that project's own root — so both matched nothing, silently.
Measured on `main` before the fix: `test-node` collected 41 files instead of 476, and 435 of the 719
registered test files were collected by no gate job at all (every `packages/*` suite, every `tooling/*`
suite, and `apps/sign-worker`, which was also missing from the job's path list).

Scope: switch every gate test invocation to absolute (`"$PWD/..."`) paths, add `apps/sign-worker`, and
add a `test-collection` gate job running a new `pnpm run lint:test-collection`. That lint re-runs each
of the gate's invocations in list-only mode and asserts a committed collection floor, that the union of
the jobs equals the whole registry, and that the jobs are disjoint; it holds each invocation verbatim
and checks it against `.github/workflows/gate.yml` so the two cannot drift.

Does not touch branch protection (the required check stays the aggregate `gate` job) and does not
un-suspend either austerity-suspended trigger. No ADR — this is a defect in how an existing job was
spelled, not a decision.
