---
number: 104
slug: parallel-doc-fragments
status: Accepted
date: 2026-06-18
area: Dev guidelines
summary: CHANGELOG and ADRs move to per-entry fragment files assembled on main; ADR numbers are assigned at merge (contiguous, stable); supersedes the prior changelog-automation open line.
---

Parallel worktrees collided on `CHANGELOG.md` and the ADR register, and concurrent branches could silently pick the same ADR number. Decision: branches add fragment files only (`changelog.d/<slug>.md`, `docs/decisions/pending/<slug>.md`); the rendered files are assembled on `main` by `vp run changelog-build` / `vp run decisions-build`. ADRs become a directory of permanent per-file records numbered at merge — contiguous and stable. CHANGELOG fragments are consumed into `[Unreleased]`. This closes the prior open changelog-automation line in favor of an in-house assembler (no external dependency). STATUS.md stays manual with a one-row-per-slice discipline. Rejected: per-branch reserved number ranges (non-contiguous) and write-time numbering with merge-time renumber (reintroduces instability).
