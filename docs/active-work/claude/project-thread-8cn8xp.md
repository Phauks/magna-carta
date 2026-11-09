---
worktree: (none — this stream runs in a cloud session's checkout)
area: Hosted checks and pull-request upkeep — `pnpm gate` back on a runner as the `gate` check, the PR upkeep and Preview cleanup workflows, and the thread rules for landing parallel pull requests
status: review
touches: .github/workflows/, tooling/preview-cleanup/, vite.config.ts, CLAUDE.md, docs/conventions/build-performance.md, docs/conventions/operations.md, docs/deploy-queue.md, docs/decisions/pending/
---

Restores a hosted run of `pnpm gate` (`ci.yml`), ports `pr-upkeep.yml` and `preview-cleanup.yml`
from the Grim-Games repository, and adds the merge-before-push, `git merge-tree` and auto-merge
rules to the root `CLAUDE.md`. Touches no product code; a stream editing the root `CLAUDE.md`'s
_How we work_ list should merge this first.
