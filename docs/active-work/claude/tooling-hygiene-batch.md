---
branch: claude/tooling-hygiene-batch
worktree: .claude/worktrees/agent-ac7b56babc8d6b40d
area: four independent tooling/hygiene repairs — bootstrap invocation guard, active-work sweep, search-core test determinism, changelog assembler
status: review
touches: tooling/bootstrap/, tooling/doc-fragments/changelog.mjs, crates/search-core/, docs/active-work/, status.d/, docs/conventions/documentation-style.md, apps/worker/src/editing/CLAUDE.md, changelog.d/
---

One batch, four unrelated fixes plus two documentation corrections.

**Bootstrap invocation guard.** `tooling/bootstrap/invocation-environment.mjs` (new) refuses a run whose caller is standing in a different checkout from the one the script belongs to, and a run in a checkout with no dependencies installed. Touches `tooling/bootstrap/index.mjs` only at its top.

**Active-work sweep.** Thirty-one notes deleted for streams whose work is fully on `main`, verified branch-by-branch (branch tip equal to its merged pull request's head, or the branch gone from origin with its content on `main`). Kept: `file-surface-web`, `slice-0-7b-app-shell` (both carry real unmerged source), and `claude/passive-dev-orchestrator-m7f9jw` (live worktree). Five `status.d` fragments repointed to `branch: main` in the same change — `2-4-in-app-conversion`, `2-5-pdf-services-e-signature-core`, `discovery-search-index`, `searchable-pdf-writer`, `slice-4-1-conflicts`. **A concurrent stream that owns one of those fragments should say so before this merges.**

**search-core determinism.** `build_split` now indexes on one thread so a batch is one segment; the split's size and a query's read cost stop varying with thread scheduling.

**Changelog assembler.** `parseFragment` strips a leading list marker so a fragment body written as a bullet does not render as `- - `.
