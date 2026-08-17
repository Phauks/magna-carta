---
worktree: C:/dev/magna-carta-worktrees/claude/stale-truths
area: three stale-truth defects — test-single-flight EPIPE, a false `.first()` rule in area guides, a false premise in gate.yml
status: building
touches: tooling/test-single-flight/, tooling/lint-test-collection/, tooling/affected-lint/, .github/workflows/gate.yml, docs/conventions/build-performance.md, packages/billing/CLAUDE.md, packages/costs/CLAUDE.md, packages/trust/CLAUDE.md, packages/data-access/src/idempotency-statements.ts, packages/billing/src/statements.ts, packages/custodian/src/close-advisory.ts, packages/trust/src/, changelog.d/
---

Three independent documentation-or-tooling truth fixes, batched. `tooling/test-single-flight/index.mjs`
gains EPIPE handling so a run piped to `head` ends and releases the lock instead of wedging at 0% CPU.
The `.all()` + `results[0]`, never `.first()` rule is restated on its real ground (the node-sqlite
adapter gained `.first()` in June, so the stated justification is false) across three area `CLAUDE.md`
files and the source comments that repeat it. `.github/workflows/gate.yml` has its empty-filter premise
corrected to the silent-narrowing case that actually justifies `test-collection`.

Touches no product behaviour. Staying out of `packages/notifications` entirely.
