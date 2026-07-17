---
branch: claude/gate-yml-review-e5q19j
worktree: (web session)
area: CI gate review — close test-coverage holes, harden path classification
status: review
touches: .github/workflows/gate.yml, vite.config.ts, docs/conventions/build-performance.md, changelog.d/, containers/scan/{src/spool.rs,tests}
---

Reviewed `.github/workflows/gate.yml` and closed the holes the review surfaced: the seven standalone
workers' vitest suites were unregistered in the root `test.projects` list and ran nowhere — now
registered and run in `test-node`; the container Cargo workspaces' tests now run in the `containers`
job (`cargo test` per changed container), and an unmapped changed container fails loud instead of
passing green; the dispatch diff base falls back to the merge-base with `origin/main`; `affected-lint`
crashes fail the gate instead of silently degrading. Touches the gate workflow and the root vite
config's test-project registry — coordinate before overlapping edits to either.
