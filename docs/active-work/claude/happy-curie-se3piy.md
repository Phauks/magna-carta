---
worktree: C:/dev/magna-carta-worktrees/claude/happy-curie-se3piy
area: Documentation accuracy pass — root and conventions docs, the maintenance runbook, stale stream notes, dead links
status: review
touches: CLAUDE.md, README.md, ROADMAP.md, docs/conventions/, docs/maintenance/README.md, docs/active-work/, status.d/, STATUS.md, .github/workflows/gate.yml, tooling/git-hooks/pre-push
---

A review of the repository's documentation against what the repository actually does, changing only
statements that could be verified: the install order and test command in the README, the hook
activation and WASM package list in the root `CLAUDE.md`, the maintenance runbook's claims about the
per-merge assembly (blocked account-side since 2026-08-05) and the docs-sync Routine (created, and
duplicated), the documentation standard's list of lint rules that exist, the conventions index, the
deploy-model comments in the gate workflow and the pre-push hook, two stale roadmap sentences, and
the relative links that broke when files moved. It also retires the 22 stream notes whose branches
had landed. Nothing about the database layer is touched: that area has a concurrent stream.
