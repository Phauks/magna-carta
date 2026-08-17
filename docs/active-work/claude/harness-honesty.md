---
worktree: /home/user/magna-carta/.claude/worktrees/harness-honesty
area: development harness — active-work note retirement, test-runner process-group teardown, diff-scoped type-check
status: building
touches: tooling/worktrees, tooling/test-single-flight, tooling/check-scoped, tooling/retire-note, vite.config.ts, package.json, docs/conventions/build-performance.md, docs/active-work/README.md, CLAUDE.md, changelog.d
---

Three harness defects, all in `tooling/`: (1) retiring an active-work note leaves any `status.d/`
fragment pointing at it dangling, so `lint:status` fails after the fact — made into one operation;
(2) `pnpm test` kills only the direct child, so vitest runners outlive the run with the lock already
released — teardown moved to the process group; (3) `check:scoped` type-checks unconditionally, which
forces a docs-only diff to build three Rust crates first — the type-check step is now diff-scoped and
the wasm-artefact prerequisite scopes with it.

Nothing outside `tooling/` and its documentation is touched. `packages/calendar` and `roadmap.d/` are
another stream's.
