---
branch: claude/lint-dependency-fanout
worktree: .claude/worktrees/agent-ad800aff618c3799b
area: CI cost — the type-aware lint's dependency fan-out through `apps/worker`
status: building
touches: tooling/affected-lint/, .github/workflows/gate.yml, docs/conventions/build-performance.md, changelog.d/lint-dependency-fanout.md, docs/decisions/pending/lint-affected-file-scope.md
---

The `lint` job is 43% of the measured CI bill (26 billable minutes of ~60 on a real pull-request run,
`docs/research/2026-08-05-cloudflare-ci-evaluation.md`). `tooling/affected-lint` already scopes the
type-aware pass to the changed packages plus their dependents, but the scope is computed at PACKAGE
granularity and `apps/worker` depends directly on 39 of the repo's 61 workspace packages — so almost any
foundational change drags the worker's entire source tree, and therefore its whole-program type graph,
into the scope. Package-level scoping is exhausted as a lever.

Scope: refine the affected computation from package granularity to FILE granularity — the changed files
plus the transitive reverse-import closure over the repository's own module graph — while keeping the
package-level closure as the provable upper bound. The narrowing must be a subset of the package-level
answer by construction, with a fitness check that proves it (in the spirit of `lint:test-collection`),
and it must fail safe to the package-level scope on any resolution it cannot account for.

Does not un-suspend any `TEMPORARY CI AUSTERITY 2026-08-05` marker and does not touch branch protection.
